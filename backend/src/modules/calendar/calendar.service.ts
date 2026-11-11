import { Injectable, Optional } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildCalendar, sequenceOf, type IcsEvent, type IcsPerson } from '../../common/utils/ics';
import { fullName } from '../../common/utils/names';
import { addDays, zonedParts } from '../../common/utils/zoned-time';
import { AppConfig } from '../../config/app-config.service';
import { Candidate, Employee, Holiday, Interview, InterviewPanelist, JobApplication, JobOpening, LeaveRequest, LeaveType, OneOnOne, Organization, OrganizationMembership, User } from '../../database/models';
import { generateToken, sha256 } from '../../infrastructure/crypto/tokens';
import { MailService } from '../../infrastructure/mail/mail.service';
import { calendarInviteEmail } from '../../infrastructure/mail/templates';
import { userIdsOf } from '../employees/employee-people';

const CROSS = { skipTenantScope: true } as const;
const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 400;
const domain = 'hrms';

type Method = 'REQUEST' | 'CANCEL';

/**
 * Calendar invites and feeds. Approved leave, interviews and 1:1s are emailed as iCalendar invites (.ics) that Google
 * Calendar, Outlook and Apple Calendar add, update (same UID, rising sequence) or remove; people can switch the invites
 * off. Each member can also subscribe to a private feed URL with their leave, their team's leave, 1:1s, interviews they
 * sit on and holidays.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly config: AppConfig,
    @Optional() private readonly mail?: MailService,
  ) {}

  // ---- Invites ---------------------------------------------------------------------------------

  /** Approved leave blocks the employee's calendar; a cancellation removes it. */
  async leave(request: LeaveRequest, method: Method, transaction?: Transaction): Promise<void> {
    const type = request.leaveType ?? (await LeaveType.findByPk(request.leaveTypeId, { attributes: ['name'], transaction }));
    const userId = (await userIdsOf([request.employeeId], transaction)).get(request.employeeId);
    if (!userId) return;
    const event: IcsEvent = {
      uid: `leave-${request.id}@${domain}`,
      sequence: sequenceOf(new Date()),
      summary: `Out of office: ${type?.name ?? 'Leave'}`,
      description: `${request.startDate === request.endDate ? request.startDate : `${request.startDate} to ${request.endDate}`} (${Number(request.days)} day${Number(request.days) === 1 ? '' : 's'})`,
      allDay: { start: request.startDate, end: addDays(request.endDate, 1) },
      url: `${this.config.get('APP_URL')}/me/leave`,
    };
    await this.sendToUsers([userId], event, method, request.organizationId, transaction);
  }

  /** The panel and the candidate get the interview; removed panelists get a cancellation. */
  async interview(interviewId: string, method: Method, opts: { removedEmployeeIds?: string[]; transaction?: Transaction } = {}): Promise<void> {
    const { transaction } = opts;
    const i = await Interview.findByPk(interviewId, {
      include: [{ model: InterviewPanelist, attributes: ['employeeId'] }, { model: JobApplication, attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName', 'email'] }, { model: JobOpening, attributes: ['title'] }] }],
      transaction,
    });
    if (!i) return;
    const candidate = i.application?.candidate;
    const job = i.application?.job?.title ?? 'the role';
    const panel = (i.panelists ?? []).map((p) => p.employeeId);
    const panelUsers = await userIdsOf(panel, transaction);
    const event = (who: 'panel' | 'candidate'): IcsEvent => ({
      uid: `interview-${i.id}@${domain}`,
      sequence: sequenceOf(new Date()),
      summary: who === 'panel' ? `Interview: ${candidate ? fullName(candidate) : 'Candidate'} (${i.roundName}, ${job})` : `Interview for ${job}: ${i.roundName}`,
      description: `${i.mode.toLowerCase().replace('_', ' ')} interview, ${i.durationMinutes} minutes.${who === 'panel' ? ` Feedback: ${this.config.get('APP_URL')}/me/interviews` : ''}`,
      location: i.location,
      start: i.scheduledAt,
      end: new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000),
    });
    await this.sendToUsers([...panelUsers.values()], event('panel'), method, i.organizationId, transaction);
    if (candidate?.email) await this.sendToPeople([{ name: fullName(candidate), email: candidate.email }], event('candidate'), method, i.organizationId, transaction);
    if (opts.removedEmployeeIds?.length) {
      const removed = await userIdsOf(opts.removedEmployeeIds, transaction);
      await this.sendToUsers([...removed.values()], event('panel'), 'CANCEL', i.organizationId, transaction);
    }
  }

  /** Both the manager and the employee get the 1:1. */
  async oneOnOne(meeting: OneOnOne, method: Method, transaction?: Transaction): Promise<void> {
    const [manager, employee] = await Promise.all([Employee.findByPk(meeting.managerId, { attributes: ['id', 'firstName', 'lastName'], transaction }), Employee.findByPk(meeting.employeeId, { attributes: ['id', 'firstName', 'lastName'], transaction })]);
    const users = await userIdsOf([meeting.managerId, meeting.employeeId], transaction);
    const event: IcsEvent = {
      uid: `one-on-one-${meeting.id}@${domain}`,
      sequence: sequenceOf(new Date()),
      summary: `1:1: ${manager ? fullName(manager) : 'Manager'} / ${employee ? fullName(employee) : 'Employee'}`,
      description: `Topics and notes: ${this.config.get('APP_URL')}/me/performance/one-on-ones/${meeting.id}`,
      start: meeting.scheduledAt,
      end: new Date(meeting.scheduledAt.getTime() + meeting.durationMinutes * 60_000),
    };
    await this.sendToUsers([...users.values()], event, method, meeting.organizationId, transaction);
  }

  private async sendToUsers(userIds: string[], event: IcsEvent, method: Method, organizationId: string, transaction?: Transaction): Promise<void> {
    if (!userIds.length) return;
    const users = await User.findAll({ where: { id: [...new Set(userIds)], status: 'ACTIVE' }, attributes: ['id', 'email', 'firstName', 'lastName', 'notificationSettings'], transaction });
    const wanted = users.filter((u) => u.notificationSettings?.calendarInvites !== false).map((u) => ({ name: fullName(u), email: u.email }));
    await this.sendToPeople(wanted, event, method, organizationId, transaction);
  }

  /** One email per person (each sees only themselves as attendee). Queued with the change, so sent only if it commits. */
  private async sendToPeople(people: IcsPerson[], event: IcsEvent, method: Method, organizationId: string, transaction?: Transaction): Promise<void> {
    if (!this.mail || !people.length) return;
    const org = await Organization.findByPk(organizationId, { attributes: ['name', 'timezone'], transaction, ...CROSS });
    const organizer = { name: org?.name ?? this.config.get('SENDGRID_FROM_NAME'), email: this.config.get('SENDGRID_FROM_EMAIL') };
    const when = event.allDay ? (event.allDay.start === addDays(event.allDay.end, -1) ? event.allDay.start : `${event.allDay.start} to ${addDays(event.allDay.end, -1)}`) : this.formatWhen(event.start!, org?.timezone ?? 'UTC');
    for (const p of people) {
      const ics = buildCalendar([{ ...event, organizer, attendees: [p] }], { method });
      await this.mail.queue(calendarInviteEmail(p.email, p.name.split(' ')[0] ?? p.name, { title: event.summary, when, organization: org?.name ?? '', cancelled: method === 'CANCEL' }, ics, method), { transaction });
    }
  }

  private formatWhen(at: Date, timeZone: string): string {
    return `${new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(at)} (${timeZone})`;
  }

  // ---- Feeds -----------------------------------------------------------------------------------

  async feedStatus(auth: AuthContext) {
    const m = await this.membership(auth);
    return { active: !!m.calendarFeedTokenHash };
  }

  /** A new private URL (the old one stops working); shown once. */
  async rotateFeed(auth: AuthContext) {
    const m = await this.membership(auth);
    const token = generateToken();
    await m.update({ calendarFeedTokenHash: sha256(token) });
    // The API is served under the app's origin (/api), so the feed works wherever the app does.
    return { active: true, url: `${this.config.get('APP_URL')}/api/v1/calendar/feed/${token}.ics` };
  }

  async removeFeed(auth: AuthContext) {
    const m = await this.membership(auth);
    await m.update({ calendarFeedTokenHash: null });
    return { active: false };
  }

  /** The feed for a token, or null (unknown token, membership no longer active). */
  async feed(token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) return null;
    const m = await OrganizationMembership.findOne({ where: { calendarFeedTokenHash: sha256(token), status: 'ACTIVE' }, attributes: ['id', 'organizationId', 'userId'], ...CROSS });
    if (!m) return null;
    return RequestContext.runForTenant(m.organizationId, () => this.buildFeed(m));
  }

  private async buildFeed(m: OrganizationMembership): Promise<string> {
    const org = await Organization.findByPk(m.organizationId, { attributes: ['name', 'timezone'] });
    const today = zonedParts(new Date(), org?.timezone ?? 'UTC').date;
    const from = addDays(today, -FEED_PAST_DAYS);
    const to = addDays(today, FEED_FUTURE_DAYS);
    const self = await Employee.findOne({ where: { membershipId: m.id }, attributes: ['id', 'locationId', 'firstName', 'lastName'] });
    const events: IcsEvent[] = [];
    const appUrl = this.config.get('APP_URL');
    if (self) {
      const reports = await Employee.findAll({ where: { managerId: self.id, status: ['ACTIVE', 'ON_NOTICE'] }, attributes: ['id', 'firstName', 'lastName'] });
      const names = new Map(reports.map((r) => [r.id, fullName(r)]));
      const leave = await LeaveRequest.findAll({
        where: { employeeId: [self.id, ...names.keys()], status: 'APPROVED', endDate: { [Op.gte]: from }, startDate: { [Op.lte]: to } },
        include: [{ model: LeaveType, attributes: ['name'] }],
      });
      for (const l of leave) {
        const mine = l.employeeId === self.id;
        events.push({ uid: `leave-${l.id}@${domain}`, sequence: sequenceOf(l.updatedAt), summary: mine ? `Out of office: ${l.leaveType?.name ?? 'Leave'}` : `${names.get(l.employeeId)} away (${l.leaveType?.name ?? 'leave'})`, allDay: { start: l.startDate, end: addDays(l.endDate, 1) }, busy: mine, url: `${appUrl}${mine ? '/me/leave' : '/hr/leave/requests'}` });
      }
      const meetings = await OneOnOne.findAll({ where: { [Op.or]: [{ managerId: self.id }, { employeeId: self.id }], status: ['SCHEDULED', 'DONE'], scheduledAt: { [Op.between]: [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)] } } });
      const people = new Map((await Employee.findAll({ where: { id: [...new Set(meetings.flatMap((x) => [x.managerId, x.employeeId]))] }, attributes: ['id', 'firstName', 'lastName'] })).map((e) => [e.id, fullName(e)]));
      for (const x of meetings) {
        const other = people.get(x.managerId === self.id ? x.employeeId : x.managerId) ?? 'colleague';
        events.push({ uid: `one-on-one-${x.id}@${domain}`, sequence: sequenceOf(x.updatedAt), summary: `1:1 with ${other}`, start: x.scheduledAt, end: new Date(x.scheduledAt.getTime() + x.durationMinutes * 60_000), url: `${appUrl}/me/performance/one-on-ones/${x.id}` });
      }
      const interviews = await Interview.findAll({
        where: { status: { [Op.ne]: 'CANCELLED' }, scheduledAt: { [Op.between]: [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)] } },
        include: [{ model: InterviewPanelist, where: { employeeId: self.id }, required: true, attributes: ['id'] }, { model: JobApplication, attributes: ['id'], include: [{ model: Candidate, attributes: ['firstName', 'lastName'] }, { model: JobOpening, attributes: ['title'] }] }],
      });
      for (const i of interviews) {
        const c = i.application?.candidate;
        events.push({ uid: `interview-${i.id}@${domain}`, sequence: sequenceOf(i.updatedAt), summary: `Interview: ${c ? fullName(c) : 'Candidate'} (${i.roundName})`, description: i.application?.job?.title ?? null, location: i.location, start: i.scheduledAt, end: new Date(i.scheduledAt.getTime() + i.durationMinutes * 60_000), url: `${appUrl}/me/interviews` });
      }
    }
    const holidays = await Holiday.findAll({ where: { date: { [Op.between]: [from, to] } } });
    for (const h of holidays) {
      if (h.locationIds?.length && (!self?.locationId || !h.locationIds.includes(self.locationId))) continue;
      events.push({ uid: `holiday-${h.id}@${domain}`, sequence: sequenceOf(h.updatedAt), summary: `${h.name}${h.isOptional ? ' (optional holiday)' : ''}`, allDay: { start: h.date, end: addDays(h.date, 1) }, busy: false });
    }
    return buildCalendar(events, { method: 'PUBLISH', name: `${org?.name ?? 'HRMS'} · ${self ? fullName(self) : 'My calendar'}` });
  }

  private async membership(auth: AuthContext): Promise<OrganizationMembership> {
    if (!auth.membershipId) throw AppError.forbidden('Calendar feeds belong to an organization');
    const m = await OrganizationMembership.findByPk(auth.membershipId);
    if (!m) throw AppError.notFound('Membership');
    return m;
  }
}
