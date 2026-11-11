import { Injectable, Logger, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Op } from 'sequelize';
import { REPORT_FREQUENCY_LABELS, REPORT_MAX_RECIPIENTS, reportPeriod, type ReportFrequency, type ReportPeriod, type ReportRunStatus, type ReportScheduleView } from '../../../contracts';
import type { AuthContext } from '../../../common/auth/auth-context';
import { RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { fullName } from '../../../common/utils/names';
import { zonedParts } from '../../../common/utils/zoned-time';
import { AppConfig } from '../../../config/app-config.service';
import { Organization, OrganizationMembership, ReportSchedule, SavedReport, User } from '../../../database/models';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { MailService } from '../../../infrastructure/mail/mail.service';
import { scheduledReportEmail } from '../../../infrastructure/mail/templates';
import { AccessService } from '../../rbac/access.service';
import { ReportBuilderService } from '../builder/report-builder.service';
import { nextRunAt } from './schedule-time';

const CROSS = { skipTenantScope: true } as const;
const TICK_MS = 10 * 60_000;

export interface ScheduleInput {
  savedReportId: string;
  frequency: ReportFrequency;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour: number;
  format: 'csv' | 'xlsx';
  period: ReportPeriod;
  recipientIds: string[];
  isActive?: boolean;
}

/**
 * Scheduled reports: a saved report-builder report emailed daily, weekly or monthly (the organization's local time) to
 * members of the organization. It runs once per recipient with that person's own access, so each gets only the rows
 * they could see themselves; anyone who can't (no longer a member, no report export rights, no access to the data) is
 * skipped. Dated reports cover a rolling period (yesterday, last week, last monthâ€¦). Checked every 10 minutes by the
 * API server.
 */
@Injectable()
export class ReportSchedulesService implements OnModuleDestroy {
  private readonly logger = new Logger('ReportSchedules');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly builder: ReportBuilderService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
    @Optional() private readonly mail?: MailService,
  ) {}

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async list(auth: AuthContext): Promise<ReportScheduleView[]> {
    const rows = await ReportSchedule.findAll({ where: { ownerId: auth.userId }, order: [['createdAt', 'ASC']] });
    return this.present(rows);
  }

  async create(auth: AuthContext, input: ScheduleInput): Promise<ReportScheduleView> {
    const report = await this.ownReport(auth, input.savedReportId);
    const values = await this.validate(input);
    const s = await ReportSchedule.create({ organizationId: auth.organizationId!, savedReportId: report.id, ownerId: auth.userId, ...values, nextRunAt: values.isActive ? nextRunAt(values, new Date(), await this.timeZone(auth.organizationId!)) : null });
    await this.audit.record({ action: 'reports.schedule_created', entityType: 'ReportSchedule', entityId: s.id, summary: `"${report.name}" scheduled ${REPORT_FREQUENCY_LABELS[s.frequency].toLowerCase()} to ${values.recipientIds.length} recipient${values.recipientIds.length === 1 ? '' : 's'}` });
    return (await this.present([s]))[0]!;
  }

  async update(auth: AuthContext, id: string, input: ScheduleInput): Promise<ReportScheduleView> {
    const s = await this.own(auth, id);
    await this.ownReport(auth, input.savedReportId);
    const values = await this.validate(input);
    await s.update({ ...values, savedReportId: input.savedReportId, nextRunAt: values.isActive ? nextRunAt(values, new Date(), await this.timeZone(auth.organizationId!)) : null });
    await this.audit.record({ action: 'reports.schedule_updated', entityType: 'ReportSchedule', entityId: s.id, summary: 'Report schedule updated' });
    return (await this.present([s]))[0]!;
  }

  async remove(auth: AuthContext, id: string): Promise<void> {
    const s = await this.own(auth, id);
    await s.destroy();
    await this.audit.record({ action: 'reports.schedule_deleted', entityType: 'ReportSchedule', entityId: id, summary: 'Report schedule deleted' });
  }

  /** Sends it now to everyone on it (the regular schedule is unchanged). */
  async sendNow(auth: AuthContext, id: string): Promise<ReportScheduleView> {
    const s = await this.own(auth, id);
    await this.run(s, new Date());
    return (await this.present([s]))[0]!;
  }

  /** Members to pick as recipients. */
  async candidates(q: string) {
    const like = q.trim() ? `%${q.trim().replace(/[%_\\]/g, '\\$&')}%` : null;
    const members = await OrganizationMembership.findAll({
      where: { status: 'ACTIVE' },
      attributes: ['userId'],
      include: [{ model: User, attributes: ['id', 'firstName', 'lastName', 'email'], ...(like ? { where: { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { email: { [Op.iLike]: like } }] } } : {}) }],
      limit: 20,
    });
    return members.filter((m) => m.user).map((m) => ({ userId: m.user!.id, name: fullName(m.user!), email: m.user!.email }));
  }

  /** Runs the schedules that are due (all organizations); returns how many ran. */
  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let ran = 0;
    try {
      const due = await ReportSchedule.findAll({ where: { isActive: true, nextRunAt: { [Op.lte]: now } }, ...CROSS });
      for (const s of due) {
        try {
          // Claimed first (the next run moves on), so with several servers each run happens once.
          const tz = await this.timeZone(s.organizationId);
          const [claimed] = await ReportSchedule.update({ nextRunAt: nextRunAt(s, now, tz) }, { where: { id: s.id, nextRunAt: s.nextRunAt! }, ...CROSS });
          if (!claimed) continue;
          await RequestContext.runForTenant(s.organizationId, () => this.run(s, now));
          ran++;
        } catch (e) {
          this.logger.warn(`Scheduled report ${s.id} failed: ${(e as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    return ran;
  }

  private async run(s: ReportSchedule, now: Date): Promise<void> {
    const report = await SavedReport.findByPk(s.savedReportId);
    if (!report) {
      await s.update({ isActive: false, nextRunAt: null, lastRunAt: now, lastStatus: 'FAILED', lastError: 'The saved report was deleted' });
      return;
    }
    const org = await Organization.findByPk(s.organizationId, { attributes: ['name', 'timezone'] });
    const today = zonedParts(now, org?.timezone ?? 'UTC').date;
    const dated = this.builder.isDated(report.dataset);
    const range = dated ? (reportPeriod(s.period, today) ?? (report.definition.from && report.definition.to ? { from: report.definition.from, to: report.definition.to } : null)) : null;
    const query = { ...report.definition, dataset: report.dataset, ...(range ?? {}) };
    const periodLabel = range ? `${range.from} to ${range.to}` : null;
    let sent = 0;
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const userId of s.recipientIds) {
      const user = await User.findByPk(userId, { attributes: ['id', 'email', 'firstName', 'lastName', 'status'] });
      const auth = user?.status === 'ACTIVE' ? await this.contextFor(user, s.organizationId) : null;
      const who = user ? fullName(user) : 'A former user';
      if (!user || !auth || !auth.features.has('reports') || !auth.permissions.has('reports.view') || !auth.permissions.has('reports.export')) {
        skipped.push(who);
        continue;
      }
      try {
        const file = await RequestContext.runForTenant(s.organizationId, () => this.builder.export(auth, query, s.format, report.name), { userId: user.id });
        await this.mail?.send(
          scheduledReportEmail(
            user.email,
            user.firstName,
            { title: report.name, organization: org?.name ?? '', period: periodLabel, rows: file.rows, manageUrl: `${this.config.get('APP_URL')}/hr/reports/builder` },
            { filename: file.fileName, content: file.content.toString('base64'), type: file.contentType.split(';')[0]! },
          ),
        );
        sent++;
      } catch (e) {
        // Lost access to the data since (403), a period the report can't cover (422), or delivery failed.
        (e instanceof AppError && (e.code === 'FORBIDDEN' || e.code === 'VALIDATION_FAILED') ? skipped : failed).push(who);
        if (!(e instanceof AppError)) this.logger.warn(`Scheduled report ${s.id} to ${user.id} failed: ${(e as Error).message}`);
      }
    }
    const status: ReportRunStatus = sent && !skipped.length && !failed.length ? 'SENT' : sent ? 'PARTIAL' : failed.length ? 'FAILED' : 'SKIPPED';
    const notes = [skipped.length ? `Skipped (no access): ${skipped.join(', ')}` : '', failed.length ? `Not delivered: ${failed.join(', ')}` : ''].filter(Boolean).join('. ');
    await s.update({ lastRunAt: now, lastStatus: status, lastError: notes ? notes.slice(0, 500) : null });
    await RequestContext.runForTenant(s.organizationId, () =>
      this.audit.record({ action: 'reports.schedule_sent', entityType: 'ReportSchedule', entityId: s.id, organizationId: s.organizationId, actorUserId: null, summary: `"${report.name}" sent to ${sent} of ${s.recipientIds.length} recipient${s.recipientIds.length === 1 ? '' : 's'}${periodLabel ? ` (${periodLabel})` : ''}` }),
    );
  }

  /** The recipient's access in the organization, as if they ran the report themselves; null if not a member. */
  private async contextFor(user: User, organizationId: string): Promise<AuthContext | null> {
    try {
      const r = await this.access.resolve(user.id, organizationId);
      return { userId: user.id, sessionId: 'scheduled-report', email: user.email, platformRole: null, organizationId: r.organizationId, membershipId: r.membershipId, roleIds: r.roles.map((x) => x.id), permissions: r.permissions, delegated: [], features: r.features, mfaSetupRequired: false, passwordExpired: false };
    } catch {
      return null;
    }
  }

  private async validate(input: ScheduleInput) {
    const issues: { field: string; message: string }[] = [];
    if (input.frequency === 'WEEKLY' && !input.dayOfWeek) issues.push({ field: 'dayOfWeek', message: 'Choose the day of the week' });
    if (input.frequency === 'MONTHLY' && !input.dayOfMonth) issues.push({ field: 'dayOfMonth', message: 'Choose the day of the month' });
    const ids = [...new Set(input.recipientIds)];
    if (!ids.length) issues.push({ field: 'recipientIds', message: 'Add at least one recipient' });
    if (ids.length > REPORT_MAX_RECIPIENTS) issues.push({ field: 'recipientIds', message: `Up to ${REPORT_MAX_RECIPIENTS} recipients` });
    const members = ids.length ? await OrganizationMembership.findAll({ where: { userId: ids, status: 'ACTIVE' }, attributes: ['userId'] }) : [];
    if (members.length !== ids.length) issues.push({ field: 'recipientIds', message: 'Recipients must be active members of the organization' });
    if (issues.length) throw AppError.validation(issues);
    return {
      frequency: input.frequency,
      dayOfWeek: input.frequency === 'WEEKLY' ? input.dayOfWeek! : null,
      dayOfMonth: input.frequency === 'MONTHLY' ? input.dayOfMonth! : null,
      hour: input.hour,
      format: input.format,
      period: input.period,
      recipientIds: ids,
      isActive: input.isActive ?? true,
    };
  }

  private async ownReport(auth: AuthContext, id: string): Promise<SavedReport> {
    const r = await SavedReport.findByPk(id);
    if (!r || r.ownerId !== auth.userId) throw AppError.notFound('Saved report');
    return r;
  }

  private async own(auth: AuthContext, id: string): Promise<ReportSchedule> {
    const s = await ReportSchedule.findByPk(id);
    if (!s || s.ownerId !== auth.userId) throw AppError.notFound('Report schedule');
    return s;
  }

  private async timeZone(organizationId: string): Promise<string> {
    return (await Organization.findByPk(organizationId, { attributes: ['timezone'], ...CROSS }))?.timezone ?? 'UTC';
  }

  private async present(rows: ReportSchedule[]): Promise<ReportScheduleView[]> {
    if (!rows.length) return [];
    const reports = new Map((await SavedReport.findAll({ where: { id: [...new Set(rows.map((r) => r.savedReportId))] }, attributes: ['id', 'name', 'dataset'] })).map((r) => [r.id, r]));
    const userIds = [...new Set(rows.flatMap((r) => r.recipientIds))];
    const users = userIds.length ? new Map((await User.findAll({ where: { id: userIds }, attributes: ['id', 'firstName', 'lastName', 'email'] })).map((u) => [u.id, u])) : new Map<string, User>();
    return rows.map((s) => ({
      id: s.id,
      savedReportId: s.savedReportId,
      reportName: reports.get(s.savedReportId)?.name ?? 'Deleted report',
      dataset: reports.get(s.savedReportId)?.dataset ?? 'employees',
      frequency: s.frequency,
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
      hour: s.hour,
      format: s.format,
      period: s.period,
      recipients: s.recipientIds.map((id) => {
        const u = users.get(id);
        return { userId: id, name: u ? fullName(u) : 'Former user', email: u?.email ?? '' };
      }),
      isActive: s.isActive,
      nextRunAt: s.nextRunAt?.toISOString() ?? null,
      lastRunAt: s.lastRunAt?.toISOString() ?? null,
      lastStatus: s.lastStatus,
      lastError: s.lastError,
    }));
  }
}
