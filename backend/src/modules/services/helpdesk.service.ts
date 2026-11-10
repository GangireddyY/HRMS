import { Injectable } from '@nestjs/common';
import { fn, col, literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import { HELPDESK_AUTO_CLOSE_DAYS, HELPDESK_CATEGORY_LABELS, HELPDESK_SLA_HOURS, type HelpdeskPriority, type HelpdeskStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { fullName } from '../../common/utils/names';
import { allocateReference } from '../../common/utils/reference';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, HelpdeskMessage, HelpdeskTicket } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TicketDto, TicketQueryDto, TicketRatingDto, TicketReplyDto, TicketUpdateDto } from './services.dto';
import { userNames } from './service-people';

const ACTIVE: HelpdeskStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING'];
const HOUR = 3_600_000;
const dueFrom = (start: Date, priority: HelpdeskPriority) => new Date(start.getTime() + HELPDESK_SLA_HOURS[priority] * HOUR);

/**
 * The HR helpdesk: employees raise tickets (`helpdesk.raise`) and talk to HR in a thread; agents
 * (`helpdesk.manage`) pick tickets up, reply — or leave internal notes the employee never sees — and resolve them.
 * Each priority has a resolution target (HELPDESK_SLA_HOURS) that drives the overdue flag; the employee can rate a
 * resolved ticket, which closes it, and resolved tickets close by themselves after HELPDESK_AUTO_CLOSE_DAYS.
 */
@Injectable()
export class HelpdeskService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthContext, dto: TicketDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can raise helpdesk tickets');
    const priority = dto.priority ?? 'NORMAL';
    const id = await this.db.transaction(async (transaction) => {
      const reference = await allocateReference(this.db.sequelize, transaction, auth.organizationId!, 'HD', async () =>
        (await HelpdeskTicket.findAll({ attributes: ['reference'], raw: true, transaction })).map((r) => r.reference),
      );
      const now = new Date();
      const ticket = await HelpdeskTicket.create(
        {
          organizationId: auth.organizationId!,
          reference,
          employeeId: self.id,
          requestedById: auth.userId,
          category: dto.category,
          subject: dto.subject,
          priority,
          dueAt: dueFrom(now, priority),
          lastActivityAt: now,
        },
        { transaction },
      );
      // The target counts from the stored creation time, as when the priority changes later.
      if (ticket.dueAt.getTime() !== dueFrom(ticket.createdAt, priority).getTime()) await ticket.update({ dueAt: dueFrom(ticket.createdAt, priority) }, { transaction });
      await HelpdeskMessage.create({ organizationId: ticket.organizationId, ticketId: ticket.id, authorId: auth.userId, fromAgent: false, body: dto.description }, { transaction });
      await this.audit.record({ action: 'helpdesk.ticket_raised', entityType: 'HelpdeskTicket', entityId: ticket.id, summary: `${reference} raised (${HELPDESK_CATEGORY_LABELS[dto.category]})` }, transaction);
      for (const userId of await usersWithPermission('helpdesk.manage', transaction)) {
        if (userId === auth.userId) continue;
        await this.notify(userId, ticket, `New ticket ${reference}: ${dto.subject}`, `${fullName(self)} · ${HELPDESK_CATEGORY_LABELS[dto.category]}`, true, transaction);
      }
      return ticket.id;
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: TicketQueryDto) {
    await this.autoClose();
    const queue = query.view === 'queue';
    const filters: WhereOptions[] = [];
    if (queue) {
      if (!auth.permissions.has('helpdesk.manage')) throw AppError.forbidden();
      if (query.assignee === 'me') filters.push({ assigneeId: auth.userId });
      if (query.assignee === 'unassigned') filters.push({ assigneeId: null });
    } else {
      const self = await this.scope.self(auth);
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    }
    if (query.status === 'ACTIVE') filters.push({ status: ACTIVE });
    else if (query.status) filters.push({ status: query.status });
    if (query.category) filters.push({ category: query.category });
    if (query.search) {
      const like = containsPattern(query.search);
      filters.push({
        [Op.or]: [
          { reference: { [Op.iLike]: like } },
          { subject: { [Op.iLike]: like } },
          ...(queue ? [{ '$employee.first_name$': { [Op.iLike]: like } }, { '$employee.last_name$': { [Op.iLike]: like } }, { '$employee.employee_code$': { [Op.iLike]: like } }] : []),
        ],
      });
    }
    const { rows, count } = await HelpdeskTicket.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName'], include: [{ model: Department, attributes: ['id', 'name'] }] }],
      order: queue
        ? [
            [literal(`CASE WHEN "HelpdeskTicket"."status" IN ('OPEN','IN_PROGRESS','WAITING') THEN 0 ELSE 1 END`), 'ASC'],
            ['dueAt', 'ASC'],
          ]
        : [['lastActivityAt', 'DESC']],
      subQuery: false,
      ...paginationArgs(query),
    });
    const names = await userNames(rows.map((t) => t.assigneeId));
    return new PaginatedResult(
      rows.map((t) => this.present(t, names)),
      paginationMeta(query, count),
    );
  }

  /** Queue health for agents. */
  async stats(auth: AuthContext) {
    if (!auth.permissions.has('helpdesk.manage')) throw AppError.forbidden();
    await this.autoClose();
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * HOUR);
    const [active, unassigned, overdue, mine, resolved, agg] = await Promise.all([
      HelpdeskTicket.count({ where: { status: ACTIVE } }),
      HelpdeskTicket.count({ where: { status: ACTIVE, assigneeId: null } }),
      HelpdeskTicket.count({ where: { status: ACTIVE, dueAt: { [Op.lt]: now } } }),
      HelpdeskTicket.count({ where: { status: ACTIVE, assigneeId: auth.userId } }),
      HelpdeskTicket.count({ where: { resolvedAt: { [Op.gte]: since } } }),
      HelpdeskTicket.findOne({
        where: { createdAt: { [Op.gte]: since } },
        attributes: [
          [literal(`AVG(EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 3600) FILTER (WHERE "first_response_at" IS NOT NULL)`), 'firstResponse'],
          [literal(`AVG((COALESCE("resolved_at", now()) <= "due_at")::int)`), 'withinTarget'],
          [fn('AVG', col('rating')), 'rating'],
        ],
        raw: true,
      }) as unknown as Promise<{ firstResponse: string | null; withinTarget: number | null; rating: string | null } | null>,
    ]);
    const round = (v: string | number | null | undefined, d = 1) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);
    return {
      active,
      unassigned,
      overdue,
      mine,
      resolvedLast30Days: resolved,
      avgFirstResponseHours: round(agg?.firstResponse),
      withinTargetPercent: agg?.withinTarget == null ? null : Math.round(Number(agg.withinTarget) * 100),
      avgRating: round(agg?.rating),
    };
  }

  /** People who can be assigned tickets. */
  async agents(auth: AuthContext) {
    if (!auth.permissions.has('helpdesk.manage')) throw AppError.forbidden();
    const ids = await usersWithPermission('helpdesk.manage');
    const names = await userNames(ids);
    return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(auth: AuthContext, id: string) {
    const { ticket, agent } = await this.visible(auth, id);
    const messages = await HelpdeskMessage.findAll({ where: { ticketId: ticket.id, ...(agent ? {} : { internal: false }) }, order: [['createdAt', 'ASC']] });
    const names = await userNames([ticket.assigneeId, ...messages.map((m) => m.authorId)]);
    const active = ACTIVE.includes(ticket.status);
    return {
      ...this.present(ticket, names),
      messages: messages.map((m) => ({
        id: m.id,
        author: m.authorId ? (names.get(m.authorId) ?? 'Former user') : 'System',
        fromAgent: m.fromAgent,
        internal: m.internal,
        body: m.body,
        createdAt: m.createdAt,
      })),
      permissions: {
        manage: agent,
        reply: ticket.status !== 'CLOSED',
        rate: !agent && ticket.status === 'RESOLVED' && ticket.rating === null,
        reopen: !agent && ticket.status === 'RESOLVED',
        close: !agent && active,
      },
    };
  }

  async reply(auth: AuthContext, id: string, dto: TicketReplyDto) {
    await this.db.transaction(async (transaction) => {
      const { ticket, agent } = await this.visible(auth, id, transaction);
      if (ticket.status === 'CLOSED') throw AppError.conflict('This ticket is closed. Raise a new one if you still need help.');
      if (dto.internal && !agent) throw AppError.forbidden();
      if (dto.status && !agent) throw AppError.forbidden();
      const now = new Date();
      await HelpdeskMessage.create({ organizationId: ticket.organizationId, ticketId: ticket.id, authorId: auth.userId, fromAgent: agent, internal: !!dto.internal, body: dto.body }, { transaction });
      if (agent) {
        const status = dto.status ?? (dto.internal || ticket.status !== 'OPEN' ? ticket.status : 'IN_PROGRESS');
        await ticket.update(
          {
            ...this.statusChange(ticket, status, now),
            assigneeId: ticket.assigneeId ?? auth.userId,
            firstResponseAt: ticket.firstResponseAt ?? (dto.internal ? null : now),
            lastActivityAt: now,
          },
          { transaction },
        );
        if (!dto.internal && ticket.requestedById) {
          await this.notify(ticket.requestedById, ticket, `Reply on ${ticket.reference}: ${ticket.subject}`, dto.body.slice(0, 200), false, transaction);
        }
      } else {
        const reopened = ticket.status === 'WAITING' || ticket.status === 'RESOLVED';
        await ticket.update({ ...(reopened ? this.statusChange(ticket, 'OPEN', now) : {}), lastActivityAt: now }, { transaction });
        await this.tellAgents(auth, ticket, `${fullName(ticket.employee!)} replied on ${ticket.reference}`, dto.body.slice(0, 200), transaction);
      }
    });
    return this.get(auth, id);
  }

  /** Agents: status, assignee and priority (the resolution target follows the priority). */
  async update(auth: AuthContext, id: string, dto: TicketUpdateDto) {
    await this.db.transaction(async (transaction) => {
      const { ticket, agent } = await this.visible(auth, id, transaction);
      if (!agent) throw AppError.forbidden();
      const now = new Date();
      const changes: Partial<HelpdeskTicket> = { lastActivityAt: now };
      const said: string[] = [];
      if (dto.assigneeId !== undefined && dto.assigneeId !== ticket.assigneeId) {
        if (dto.assigneeId && !(await usersWithPermission('helpdesk.manage', transaction)).includes(dto.assigneeId))
          throw AppError.validation([{ field: 'assigneeId', message: "This person doesn't handle helpdesk tickets" }]);
        changes.assigneeId = dto.assigneeId;
        said.push(dto.assigneeId ? 'reassigned' : 'unassigned');
        if (dto.assigneeId && dto.assigneeId !== auth.userId) {
          await this.notify(dto.assigneeId, ticket, `${ticket.reference} was assigned to you`, ticket.subject, true, transaction);
        }
      }
      if (dto.priority && dto.priority !== ticket.priority) {
        changes.priority = dto.priority;
        changes.dueAt = dueFrom(ticket.createdAt, dto.priority);
        said.push(`priority ${dto.priority.toLowerCase()}`);
      }
      if (dto.status && dto.status !== ticket.status) {
        Object.assign(changes, this.statusChange(ticket, dto.status, now));
        said.push(dto.status.replace('_', ' ').toLowerCase());
        if (dto.status === 'RESOLVED' && ticket.requestedById) {
          await this.notify(
            ticket.requestedById,
            ticket,
            `${ticket.reference} has been resolved`,
            `Reply if you still need help, or rate how it went. It closes by itself after ${HELPDESK_AUTO_CLOSE_DAYS} days.`,
            false,
            transaction,
          );
        }
      }
      if (!said.length) return;
      await ticket.update(changes, { transaction });
      await this.audit.record({ action: 'helpdesk.ticket_updated', entityType: 'HelpdeskTicket', entityId: id, summary: `${ticket.reference}: ${said.join(', ')}` }, transaction);
    });
    return this.get(auth, id);
  }

  /** The employee rates a resolved ticket, which closes it. */
  async rate(auth: AuthContext, id: string, dto: TicketRatingDto) {
    await this.db.transaction(async (transaction) => {
      const { ticket, agent } = await this.visible(auth, id, transaction);
      if (agent) throw AppError.forbidden("You can't rate a ticket you handle");
      if (ticket.status !== 'RESOLVED') throw AppError.conflict('Only a resolved ticket can be rated');
      const now = new Date();
      await ticket.update({ rating: dto.rating, ratingComment: dto.comment ?? null, ...this.statusChange(ticket, 'CLOSED', now), lastActivityAt: now }, { transaction });
      if (ticket.assigneeId) await this.notify(ticket.assigneeId, ticket, `${ticket.reference} was rated ${dto.rating}/5`, dto.comment ?? undefined, true, transaction);
    });
    return this.get(auth, id);
  }

  /** The employee closes their own ticket (e.g. they sorted it out). */
  async close(auth: AuthContext, id: string) {
    await this.db.transaction(async (transaction) => {
      const { ticket, agent } = await this.visible(auth, id, transaction);
      if (agent) throw AppError.forbidden('Resolve the ticket instead');
      if (ticket.status === 'CLOSED') return;
      const now = new Date();
      await ticket.update({ ...this.statusChange(ticket, 'CLOSED', now), lastActivityAt: now }, { transaction });
      await HelpdeskMessage.create({ organizationId: ticket.organizationId, ticketId: ticket.id, authorId: auth.userId, fromAgent: false, body: 'Closed by the employee.' }, { transaction });
    });
    return this.get(auth, id);
  }

  private statusChange(ticket: HelpdeskTicket, status: HelpdeskStatus, now: Date): Partial<HelpdeskTicket> {
    if (status === ticket.status) return {};
    if (status === 'RESOLVED') return { status, resolvedAt: now, closedAt: null };
    if (status === 'CLOSED') return { status, resolvedAt: ticket.resolvedAt ?? now, closedAt: now };
    return { status, resolvedAt: null, closedAt: null };
  }

  private async autoClose() {
    const cutoff = new Date(Date.now() - HELPDESK_AUTO_CLOSE_DAYS * 24 * HOUR);
    await HelpdeskTicket.update({ status: 'CLOSED', closedAt: new Date() }, { where: { status: 'RESOLVED', resolvedAt: { [Op.lt]: cutoff } } });
  }

  /**
   * Agents see every ticket except their own, which they see as the employee who raised it (so nobody handles
   * their own HR query).
   */
  private async visible(auth: AuthContext, id: string, transaction?: Transaction) {
    const ticket = await HelpdeskTicket.findByPk(id, {
      include: [{ model: Employee, attributes: ['id', 'employeeCode', 'firstName', 'lastName'], include: [{ model: Department, attributes: ['id', 'name'] }] }],
      transaction,
      lock: transaction ? { level: transaction.LOCK.UPDATE, of: HelpdeskTicket } : undefined,
    });
    if (!ticket) throw AppError.notFound('Ticket');
    const self = await this.scope.self(auth);
    const own = !!self && ticket.employeeId === self.id;
    const agent = !own && auth.permissions.has('helpdesk.manage');
    if (!own && !agent) throw AppError.notFound('Ticket');
    return { ticket, agent };
  }

  private async tellAgents(auth: AuthContext, ticket: HelpdeskTicket, title: string, body: string, transaction: Transaction) {
    const to = ticket.assigneeId ? [ticket.assigneeId] : await usersWithPermission('helpdesk.manage', transaction);
    for (const userId of to) if (userId !== auth.userId) await this.notify(userId, ticket, title, body, true, transaction);
  }

  private notify(userId: string, ticket: HelpdeskTicket, title: string, body: string | undefined, agent: boolean, transaction: Transaction) {
    return this.notifications.notify(
      userId,
      { organizationId: ticket.organizationId, type: 'helpdesk.ticket', title, body, link: agent ? `/hr/helpdesk/${ticket.id}` : `/me/helpdesk/${ticket.id}` },
      transaction,
    );
  }

  private present(t: HelpdeskTicket, names: Map<string, string>) {
    const active = ACTIVE.includes(t.status);
    return {
      id: t.id,
      reference: t.reference,
      category: t.category,
      subject: t.subject,
      priority: t.priority,
      status: t.status,
      employee: t.employee ? { id: t.employee.id, name: fullName(t.employee), employeeCode: t.employee.employeeCode, department: t.employee.department?.name ?? null } : null,
      assignee: t.assigneeId ? { id: t.assigneeId, name: names.get(t.assigneeId) ?? 'Former user' } : null,
      dueAt: t.dueAt,
      overdue: active && t.dueAt.getTime() < Date.now(),
      firstResponseAt: t.firstResponseAt,
      resolvedAt: t.resolvedAt,
      closedAt: t.closedAt,
      rating: t.rating,
      ratingComment: t.ratingComment,
      lastActivityAt: t.lastActivityAt,
      createdAt: t.createdAt,
    };
  }
}
