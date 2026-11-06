import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { DatabaseService } from '../../database/database.service';
import { Announcement, AnnouncementResponse, Department, Employee } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { personRef, userIdsOf } from '../employees/employee-people';
import { NotificationsService } from '../notifications/notifications.service';
import type { AnnouncementDto, AnnouncementQueryDto, RsvpDto, UpdateAnnouncementDto } from './dto/engagement.dto';
import { inAudience, type Audience } from './engagement-rules';

const FEED_WINDOW = 300;
const ZERO = { acknowledged: 0, going: 0, maybe: 0, notGoing: 0 };

/** Active employees in an audience (null lists = everyone). */
export async function audienceEmployees(a: Audience, transaction?: Transaction): Promise<Employee[]> {
  return Employee.findAll({
    where: {
      status: ['ACTIVE', 'ON_NOTICE'],
      ...(a.departmentIds?.length ? { departmentId: a.departmentIds } : {}),
      ...(a.locationIds?.length ? { locationId: a.locationIds } : {}),
    },
    attributes: ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId', 'locationId', 'membershipId'],
    include: [{ model: Department, attributes: ['id', 'name'] }],
    transaction,
  });
}

/** Announcements and events (`engagement.announcement.manage` publishes; everyone in the audience reads, acknowledges, RSVPs). */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: AnnouncementQueryDto) {
    const manage = !!query.manage && auth.permissions.has('engagement.announcement.manage');
    const self = await this.scope.self(auth);
    const conditions: WhereOptions[] = [];
    if (manage) {
      if (query.status) conditions.push({ status: query.status });
    } else {
      conditions.push({ status: 'PUBLISHED', [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] });
    }
    if (query.category) conditions.push({ category: query.category });
    if (query.search) conditions.push({ [Op.or]: [{ title: { [Op.iLike]: containsPattern(query.search) } }, { body: { [Op.iLike]: containsPattern(query.search) } }] });
    const order: [string, string][] = manage ? [['updatedAt', 'DESC']] : [['pinned', 'DESC'], ['publishedAt', 'DESC']];
    let rows: Announcement[];
    let total: number;
    if (manage) {
      const r = await Announcement.findAndCountAll({ where: { [Op.and]: conditions }, order, ...paginationArgs(query) });
      rows = r.rows;
      total = r.count;
    } else {
      // Audience lists are small JSON arrays: filter the recent window in memory.
      const visible = (await Announcement.findAll({ where: { [Op.and]: conditions }, order, limit: FEED_WINDOW })).filter((a) => this.canSee(a, self));
      total = visible.length;
      rows = visible.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    }
    const mine = self && rows.length ? await AnnouncementResponse.findAll({ where: { employeeId: self.id, announcementId: rows.map((r) => r.id) } }) : [];
    const counts = manage ? await this.counts(rows.map((r) => r.id)) : new Map<string, typeof ZERO>();
    return new PaginatedResult(
      rows.map((a) => this.present(a, mine.find((m) => m.announcementId === a.id) ?? null, manage ? (counts.get(a.id) ?? ZERO) : undefined)),
      paginationMeta(query, total),
    );
  }

  async get(auth: AuthContext, id: string) {
    const a = await this.find(id);
    const self = await this.scope.self(auth);
    const manage = auth.permissions.has('engagement.announcement.manage');
    if (!manage && !(this.isLive(a) && this.canSee(a, self))) throw AppError.notFound('Announcement');
    const mine = self ? await AnnouncementResponse.findOne({ where: { announcementId: id, employeeId: self.id } }) : null;
    return this.present(a, mine, manage ? ((await this.counts([id])).get(id) ?? ZERO) : undefined);
  }

  async create(auth: AuthContext, dto: AnnouncementDto) {
    this.validate(dto);
    const a = await this.db.transaction(async (transaction) => {
      const created = await Announcement.create({ organizationId: auth.organizationId!, ...this.values(dto), createdById: auth.userId, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'engagement.announcement_created', entityType: 'Announcement', entityId: created.id, summary: `Announcement "${created.title}" drafted` }, transaction);
      return created;
    });
    return this.get(auth, a.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateAnnouncementDto) {
    const a = await this.find(id);
    if (a.status === 'ARCHIVED') throw AppError.conflict('An archived announcement can no longer be changed');
    const merged = { category: a.category, eventStartsAt: a.eventStartsAt?.toISOString() ?? null, eventEndsAt: a.eventEndsAt?.toISOString() ?? null, ...dto } as AnnouncementDto;
    this.validate(merged);
    await this.db.transaction(async (transaction) => {
      await a.update({ ...this.values(dto), ...(merged.category !== 'EVENT' ? { eventStartsAt: null, eventEndsAt: null, eventLocation: null } : {}), updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'engagement.announcement_updated', entityType: 'Announcement', entityId: id, summary: `Announcement "${a.title}" updated` }, transaction);
    });
    return this.get(auth, id);
  }

  /** Publishes now; acknowledgements, alerts and events also notify the audience. */
  async publish(auth: AuthContext, id: string) {
    const a = await this.find(id);
    if (a.status !== 'DRAFT') throw AppError.conflict('Only a draft can be published');
    await this.db.transaction(async (transaction) => {
      await a.update({ status: 'PUBLISHED', publishedAt: new Date(), updatedById: auth.userId }, { transaction });
      let notified = 0;
      if (a.requiresAck || a.category === 'ALERT' || a.category === 'EVENT') {
        const people = await audienceEmployees({ departmentIds: a.departmentIds, locationIds: a.locationIds }, transaction);
        const users = await userIdsOf(people.map((p) => p.id), transaction);
        for (const userId of users.values()) {
          if (userId === auth.userId) continue;
          await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'engagement.announcement', title: a.requiresAck ? `Please read and acknowledge: ${a.title}` : a.title, link: `/me/engagement/announcements/${a.id}` }, transaction);
          notified++;
        }
      }
      await this.audit.record({ action: 'engagement.announcement_published', entityType: 'Announcement', entityId: id, summary: `Announcement "${a.title}" published`, metadata: { notified } }, transaction);
    });
    return this.get(auth, id);
  }

  async archive(auth: AuthContext, id: string) {
    const a = await this.find(id);
    if (a.status !== 'PUBLISHED') throw AppError.conflict('Only a published announcement can be archived');
    await this.db.transaction(async (transaction) => {
      await a.update({ status: 'ARCHIVED', pinned: false, updatedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'engagement.announcement_archived', entityType: 'Announcement', entityId: id, summary: `Announcement "${a.title}" archived` }, transaction);
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string) {
    const a = await this.find(id);
    if (a.status !== 'DRAFT') throw AppError.conflict('Only a draft can be deleted; archive it instead');
    await this.db.transaction(async (transaction) => {
      await a.destroy({ transaction });
      await this.audit.record({ action: 'engagement.announcement_deleted', entityType: 'Announcement', entityId: id, summary: `Draft announcement "${a.title}" deleted` }, transaction);
    });
  }

  async acknowledge(auth: AuthContext, id: string) {
    const { a, self } = await this.forResponse(auth, id);
    if (!a.requiresAck) throw AppError.conflict("This announcement doesn't ask for an acknowledgement");
    const r = await this.response(auth, a, self);
    if (!r.acknowledgedAt) await r.update({ acknowledgedAt: new Date() });
    return this.get(auth, id);
  }

  async rsvp(auth: AuthContext, id: string, dto: RsvpDto) {
    const { a, self } = await this.forResponse(auth, id);
    if (a.category !== 'EVENT') throw AppError.conflict('Only events take RSVPs');
    if ((a.eventEndsAt ?? a.eventStartsAt)! < new Date()) throw AppError.conflict('This event is over');
    await (await this.response(auth, a, self)).update({ rsvp: dto.response });
    return this.get(auth, id);
  }

  /** Who in the audience has acknowledged / responded (managers). */
  async tracking(id: string) {
    const a = await this.find(id);
    const [people, responses] = await Promise.all([audienceEmployees({ departmentIds: a.departmentIds, locationIds: a.locationIds }), AnnouncementResponse.findAll({ where: { announcementId: id } })]);
    const byEmployee = new Map(responses.map((r) => [r.employeeId, r]));
    return {
      audience: people.length,
      people: people
        .map((p) => {
          const r = byEmployee.get(p.id);
          return { employee: { ...personRef(p)!, department: p.department?.name ?? null }, acknowledgedAt: r?.acknowledgedAt ?? null, rsvp: r?.rsvp ?? null };
        })
        .sort((x, y) => Number(!!x.acknowledgedAt) - Number(!!y.acknowledgedAt) || x.employee.name.localeCompare(y.employee.name)),
    };
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async find(id: string) {
    const a = await Announcement.findByPk(id);
    if (!a) throw AppError.notFound('Announcement');
    return a;
  }

  private isLive(a: Announcement) {
    return a.status === 'PUBLISHED' && (!a.expiresAt || a.expiresAt > new Date());
  }

  /** People without an employee record (e.g. administrators) see announcements meant for everyone. */
  private canSee(a: Announcement, self: Employee | null) {
    if (!self) return !a.departmentIds?.length && !a.locationIds?.length;
    return inAudience({ departmentIds: a.departmentIds, locationIds: a.locationIds }, self);
  }

  private async forResponse(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can respond to announcements');
    const a = await this.find(id);
    if (!this.isLive(a) || !this.canSee(a, self)) throw AppError.notFound('Announcement');
    return { a, self };
  }

  private async response(auth: AuthContext, a: Announcement, self: Employee) {
    const [r] = await AnnouncementResponse.findOrCreate({ where: { announcementId: a.id, employeeId: self.id }, defaults: { organizationId: auth.organizationId!, announcementId: a.id, employeeId: self.id } });
    return r;
  }

  private async counts(ids: string[]) {
    const out = new Map<string, { acknowledged: number; going: number; maybe: number; notGoing: number }>();
    if (!ids.length) return out;
    for (const r of await AnnouncementResponse.findAll({ where: { announcementId: ids }, attributes: ['announcementId', 'acknowledgedAt', 'rsvp'] })) {
      const c = out.get(r.announcementId) ?? { acknowledged: 0, going: 0, maybe: 0, notGoing: 0 };
      if (r.acknowledgedAt) c.acknowledged++;
      if (r.rsvp === 'GOING') c.going++;
      else if (r.rsvp === 'MAYBE') c.maybe++;
      else if (r.rsvp === 'NOT_GOING') c.notGoing++;
      out.set(r.announcementId, c);
    }
    return out;
  }

  private values(dto: UpdateAnnouncementDto) {
    const date = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));
    return Object.fromEntries(
      Object.entries({
        title: dto.title,
        body: dto.body,
        category: dto.category,
        pinned: dto.pinned,
        requiresAck: dto.requiresAck,
        departmentIds: dto.departmentIds === undefined ? undefined : dto.departmentIds?.length ? dto.departmentIds : null,
        locationIds: dto.locationIds === undefined ? undefined : dto.locationIds?.length ? dto.locationIds : null,
        eventStartsAt: date(dto.eventStartsAt),
        eventEndsAt: date(dto.eventEndsAt),
        eventLocation: dto.eventLocation,
        expiresAt: date(dto.expiresAt),
      }).filter(([, v]) => v !== undefined),
    ) as unknown as Partial<Announcement> & { title: string; body: string };
  }

  private validate(dto: AnnouncementDto) {
    const issues: { field: string; message: string }[] = [];
    if (dto.category === 'EVENT' && !dto.eventStartsAt) issues.push({ field: 'eventStartsAt', message: 'Give the event a start time' });
    if (dto.eventStartsAt && dto.eventEndsAt && new Date(dto.eventEndsAt) <= new Date(dto.eventStartsAt)) issues.push({ field: 'eventEndsAt', message: 'The event must end after it starts' });
    if (issues.length) throw AppError.validation(issues);
  }

  private present(a: Announcement, mine: AnnouncementResponse | null, counts?: { acknowledged: number; going: number; maybe: number; notGoing: number }) {
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      category: a.category,
      pinned: a.pinned,
      requiresAck: a.requiresAck,
      departmentIds: a.departmentIds,
      locationIds: a.locationIds,
      eventStartsAt: a.eventStartsAt,
      eventEndsAt: a.eventEndsAt,
      eventLocation: a.eventLocation,
      status: a.status,
      publishedAt: a.publishedAt,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
      mine: { acknowledgedAt: mine?.acknowledgedAt ?? null, rsvp: mine?.rsvp ?? null },
      ...(counts ? { counts } : {}),
    };
  }
}
