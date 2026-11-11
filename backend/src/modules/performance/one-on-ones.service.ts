import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { minutesToTime, zonedParts } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, OneOnOne, OneOnOneItem, Organization } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { CalendarService } from '../calendar/calendar.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CompleteOneOnOneDto, OneOnOneDto, OneOnOneItemDto, OneOnOneQueryDto, UpdateOneOnOneDto, UpdateOneOnOneItemDto } from './dto/performance.dto';
import { fullName, personRef, userIdsOf } from './performance-people';

const PERSON_ATTRS = ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId', 'status'];
const MAX_ITEMS = 60;

/**
 * 1:1s between a manager (`performance.review` covering the employee) and one of their people. Both see the agenda,
 * shared notes and actions; the manager's private notes are theirs alone. Completing a 1:1 can schedule the next one,
 * carrying open topics and actions forward. HR does not see 1:1s.
 */
@Injectable()
export class OneOnOnesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
    private readonly calendar: CalendarService,
  ) {}

  async list(auth: AuthContext, query: OneOnOneQueryDto) {
    const self = await this.scope.self(auth);
    if (!self) return new PaginatedResult([], paginationMeta(query, 0));
    const view = query.view ?? 'mine';
    const where: WhereOptions = {
      ...(view === 'mine' ? { employeeId: self.id } : { managerId: self.id, ...(query.employeeId ? { employeeId: query.employeeId } : {}) }),
      ...(query.status ? { status: query.status } : {}),
    };
    const { rows, count } = await OneOnOne.findAndCountAll({
      where,
      include: this.people(),
      order: [['scheduledAt', 'DESC']],
      distinct: true,
      ...paginationArgs(query),
    });
    const counts = await this.itemCounts(rows.map((r) => r.id));
    return new PaginatedResult(rows.map((m) => ({ ...this.summary(m), ...(counts.get(m.id) ?? { topics: 0, openActions: 0 }) })), paginationMeta(query, count));
  }

  /** The caller's direct reports with their last and next 1:1 (managers only). */
  async team(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return [];
    const reports = await Employee.findAll({
      where: { managerId: self.id, status: ['ACTIVE', 'ON_NOTICE'] },
      attributes: PERSON_ATTRS,
      include: [{ model: Department, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
    });
    if (!reports.length) return [];
    const meetings = await OneOnOne.findAll({ where: { managerId: self.id, employeeId: reports.map((r) => r.id), status: ['SCHEDULED', 'DONE'] }, attributes: ['id', 'employeeId', 'status', 'scheduledAt', 'completedAt'], order: [['scheduledAt', 'ASC']] });
    const now = Date.now();
    return reports.map((r) => {
      const mine = meetings.filter((m) => m.employeeId === r.id);
      const last = [...mine].reverse().find((m) => m.status === 'DONE') ?? null;
      const next = mine.find((m) => m.status === 'SCHEDULED') ?? null;
      const daysSince = last ? Math.floor((now - new Date(last.completedAt ?? last.scheduledAt).getTime()) / 86_400_000) : null;
      return {
        employee: { ...personRef(r)!, department: r.department?.name ?? null },
        last: last ? { id: last.id, at: last.completedAt ?? last.scheduledAt } : null,
        next: next ? { id: next.id, at: next.scheduledAt, overdue: next.scheduledAt.getTime() < now } : null,
        daysSinceLast: daysSince,
      };
    });
  }

  async get(auth: AuthContext, id: string) {
    const { meeting, isManager, isEmployee } = await this.access(auth, id);
    const items = await OneOnOneItem.findAll({ where: { meetingId: id }, order: [['kind', 'DESC'], ['createdAt', 'ASC']] });
    const owners = new Map([meeting.manager!, meeting.employee!].map((e) => [e.id, fullName(e)]));
    const previous = await OneOnOne.findOne({
      where: { managerId: meeting.managerId, employeeId: meeting.employeeId, status: 'DONE', scheduledAt: { [Op.lt]: meeting.scheduledAt } },
      attributes: ['id', 'scheduledAt', 'completedAt'],
      order: [['scheduledAt', 'DESC']],
    });
    const open = meeting.status === 'SCHEDULED';
    return {
      ...this.summary(meeting),
      sharedNotes: meeting.sharedNotes,
      managerNotes: isManager ? meeting.managerNotes : null,
      completedAt: meeting.completedAt,
      items: items.map((i) => ({
        id: i.id,
        kind: i.kind,
        text: i.text,
        owner: i.ownerEmployeeId ? { id: i.ownerEmployeeId, name: owners.get(i.ownerEmployeeId) ?? null } : null,
        dueDate: i.dueDate,
        done: i.done,
        doneAt: i.doneAt,
        addedByMe: i.addedById === auth.userId,
        createdAt: i.createdAt,
      })),
      previous: previous ? { id: previous.id, scheduledAt: previous.scheduledAt } : null,
      viewer: { isManager, isEmployee },
      permissions: {
        reschedule: isManager && open,
        editNotes: meeting.status !== 'CANCELLED',
        addItems: meeting.status !== 'CANCELLED',
        complete: isManager && open,
        cancel: isManager && open,
      },
    };
  }

  async create(auth: AuthContext, dto: OneOnOneDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can hold 1:1s');
    const employee = await Employee.findByPk(dto.employeeId, { attributes: PERSON_ATTRS });
    if (!employee) throw AppError.notFound('Employee');
    if (employee.id === self.id) throw AppError.validation([{ field: 'employeeId', message: "You can't hold a 1:1 with yourself" }]);
    if (!(await this.scope.covers(auth, 'performance.review', employee))) throw AppError.notFound('Employee');
    if (!['ACTIVE', 'ON_NOTICE'].includes(employee.status)) throw AppError.conflict(`${fullName(employee)} is not an active employee`);
    const meeting = await this.db.transaction(async (transaction) => {
      const m = await this.schedule(auth, self.id, employee.id, new Date(dto.scheduledAt), dto.durationMinutes ?? 30, transaction);
      if (dto.topics?.length) {
        await OneOnOneItem.bulkCreate(dto.topics.map((text) => ({ organizationId: auth.organizationId!, meetingId: m.id, kind: 'TOPIC' as const, text, addedById: auth.userId })), { transaction });
      }
      return m;
    });
    return this.get(auth, meeting.id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateOneOnOneDto) {
    const { meeting, isManager } = await this.access(auth, id);
    if (meeting.status === 'CANCELLED') throw AppError.conflict('This 1:1 was cancelled');
    if ((dto.scheduledAt || dto.durationMinutes) && (!isManager || meeting.status !== 'SCHEDULED')) throw AppError.forbidden('Only the manager can reschedule an upcoming 1:1');
    if (dto.managerNotes !== undefined && !isManager) throw AppError.forbidden('Private notes are the manager’s');
    const rescheduled = !!dto.scheduledAt && new Date(dto.scheduledAt).getTime() !== meeting.scheduledAt.getTime();
    await this.db.transaction(async (transaction) => {
      await meeting.update(
        {
          ...(dto.scheduledAt ? { scheduledAt: new Date(dto.scheduledAt) } : {}),
          ...(dto.durationMinutes ? { durationMinutes: dto.durationMinutes } : {}),
          ...(dto.sharedNotes !== undefined ? { sharedNotes: dto.sharedNotes } : {}),
          ...(dto.managerNotes !== undefined ? { managerNotes: dto.managerNotes } : {}),
        },
        { transaction },
      );
      if (rescheduled || dto.durationMinutes) {
        if (rescheduled) {
          await this.audit.record({ action: 'performance.one_on_one_rescheduled', entityType: 'OneOnOne', entityId: id, summary: `1:1 with ${meeting.employee!.employeeCode} moved` }, transaction);
          await this.notify(auth, meeting.employeeId, id, `Your 1:1 with ${fullName(meeting.manager!)} moved to ${await this.when(auth, meeting.scheduledAt)}`, transaction);
        }
        await this.calendar.oneOnOne(meeting, 'REQUEST', transaction);
      }
    });
    return this.get(auth, id);
  }

  async addItem(auth: AuthContext, id: string, dto: OneOnOneItemDto) {
    const { meeting, isManager } = await this.access(auth, id);
    if (meeting.status === 'CANCELLED') throw AppError.conflict('This 1:1 was cancelled');
    if ((await OneOnOneItem.count({ where: { meetingId: id } })) >= MAX_ITEMS) throw AppError.conflict(`A 1:1 can have up to ${MAX_ITEMS} topics and actions`);
    const action = dto.kind === 'ACTION';
    const owner = action ? (dto.ownerEmployeeId ?? null) : null;
    if (owner && owner !== meeting.managerId && owner !== meeting.employeeId) throw AppError.validation([{ field: 'ownerEmployeeId', message: 'An action belongs to the manager or the employee' }]);
    await this.db.transaction(async (transaction) => {
      await OneOnOneItem.create({ organizationId: auth.organizationId!, meetingId: id, kind: dto.kind, text: dto.text, addedById: auth.userId, ownerEmployeeId: owner, dueDate: action ? (dto.dueDate ?? null) : null }, { transaction });
      if (!action && meeting.status === 'SCHEDULED') {
        const other = isManager ? meeting.employeeId : meeting.managerId;
        const by = isManager ? meeting.manager! : meeting.employee!;
        await this.notify(auth, other, id, `${fullName(by)} added a topic for your 1:1`, transaction, dto.text);
      }
    });
    return this.get(auth, id);
  }

  async updateItem(auth: AuthContext, itemId: string, dto: UpdateOneOnOneItemDto) {
    const item = await this.item(itemId);
    const { meeting } = await this.access(auth, item.meetingId);
    if (meeting.status === 'CANCELLED') throw AppError.conflict('This 1:1 was cancelled');
    if (dto.text !== undefined && item.addedById !== auth.userId) throw AppError.forbidden('Only whoever added it can reword it');
    await item.update({
      ...(dto.text !== undefined ? { text: dto.text } : {}),
      ...(dto.done !== undefined ? { done: dto.done, doneAt: dto.done ? new Date() : null } : {}),
    });
    return this.get(auth, meeting.id);
  }

  async removeItem(auth: AuthContext, itemId: string) {
    const item = await this.item(itemId);
    const { meeting, isManager } = await this.access(auth, item.meetingId);
    if (meeting.status !== 'SCHEDULED') throw AppError.conflict('Items of a past 1:1 stay on record');
    if (item.addedById !== auth.userId && !isManager) throw AppError.forbidden('Only whoever added it (or the manager) can remove it');
    await item.destroy();
    return this.get(auth, meeting.id);
  }

  async complete(auth: AuthContext, id: string, dto: CompleteOneOnOneDto) {
    const { meeting } = await this.managed(auth, id);
    const nextAt = dto.nextAt ? new Date(dto.nextAt) : null;
    if (nextAt && nextAt.getTime() <= Date.now()) throw AppError.validation([{ field: 'nextAt', message: 'The next 1:1 must be in the future' }]);
    const next = await this.db.transaction(async (transaction) => {
      const locked = await OneOnOne.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (locked!.status !== 'SCHEDULED') throw AppError.conflict('This 1:1 is no longer open');
      await locked!.update({ status: 'DONE', completedAt: new Date() }, { transaction });
      await this.audit.record({ action: 'performance.one_on_one_completed', entityType: 'OneOnOne', entityId: id, summary: `1:1 with ${meeting.employee!.employeeCode} held` }, transaction);
      if (!nextAt) {
        await this.notify(auth, meeting.employeeId, id, `Notes from your 1:1 with ${fullName(meeting.manager!)} are ready`, transaction);
        return null;
      }
      const m = await this.schedule(auth, meeting.managerId, meeting.employeeId, nextAt, meeting.durationMinutes, transaction);
      const open = await OneOnOneItem.findAll({ where: { meetingId: id, done: false }, transaction });
      if (open.length) {
        await OneOnOneItem.bulkCreate(
          open.map((i) => ({ organizationId: auth.organizationId!, meetingId: m.id, kind: i.kind, text: i.text, addedById: i.addedById, ownerEmployeeId: i.ownerEmployeeId, dueDate: i.dueDate })),
          { transaction },
        );
      }
      return m;
    });
    return { ...(await this.get(auth, id)), next: next ? { id: next.id, scheduledAt: next.scheduledAt } : null };
  }

  async cancel(auth: AuthContext, id: string) {
    const { meeting } = await this.managed(auth, id);
    await this.db.transaction(async (transaction) => {
      await meeting.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'performance.one_on_one_cancelled', entityType: 'OneOnOne', entityId: id, summary: `1:1 with ${meeting.employee!.employeeCode} cancelled` }, transaction);
      await this.notify(auth, meeting.employeeId, id, `Your 1:1 with ${fullName(meeting.manager!)} on ${await this.when(auth, meeting.scheduledAt)} was cancelled`, transaction);
      await this.calendar.oneOnOne(meeting, 'CANCEL', transaction);
    });
    return this.get(auth, id);
  }

  // ---- internals -------------------------------------------------------------------------------

  private async schedule(auth: AuthContext, managerId: string, employeeId: string, at: Date, durationMinutes: number, transaction: Transaction) {
    const clash = await OneOnOne.count({ where: { managerId, employeeId, status: 'SCHEDULED', scheduledAt: at }, transaction });
    if (clash) throw AppError.conflict('A 1:1 is already scheduled at that time');
    const m = await OneOnOne.create({ organizationId: auth.organizationId!, managerId, employeeId, scheduledAt: at, durationMinutes, createdById: auth.userId }, { transaction });
    const manager = await Employee.findByPk(managerId, { attributes: PERSON_ATTRS, transaction });
    const employee = await Employee.findByPk(employeeId, { attributes: PERSON_ATTRS, transaction });
    await this.audit.record({ action: 'performance.one_on_one_scheduled', entityType: 'OneOnOne', entityId: m.id, summary: `1:1 with ${employee!.employeeCode} scheduled` }, transaction);
    await this.notify(auth, employeeId, m.id, `${fullName(manager!)} scheduled a 1:1 with you on ${await this.when(auth, at)}`, transaction);
    await this.calendar.oneOnOne(m, 'REQUEST', transaction);
    return m;
  }

  private async access(auth: AuthContext, id: string) {
    const meeting = await OneOnOne.findByPk(id, { include: this.people() });
    if (!meeting) throw AppError.notFound('1:1');
    const self = await this.scope.self(auth);
    const isManager = !!self && self.id === meeting.managerId;
    const isEmployee = !!self && self.id === meeting.employeeId;
    if (!isManager && !isEmployee) throw AppError.notFound('1:1');
    return { meeting, isManager, isEmployee };
  }

  private async managed(auth: AuthContext, id: string) {
    const a = await this.access(auth, id);
    if (!a.isManager) throw AppError.forbidden('Only the manager can do this');
    if (a.meeting.status !== 'SCHEDULED') throw AppError.conflict('This 1:1 is no longer open');
    return a;
  }

  private async item(id: string) {
    const item = await OneOnOneItem.findByPk(id);
    if (!item) throw AppError.notFound('Item');
    return item;
  }

  private people() {
    return [
      { model: Employee, as: 'manager', attributes: PERSON_ATTRS },
      { model: Employee, as: 'employee', attributes: PERSON_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
    ];
  }

  private summary(m: OneOnOne) {
    return {
      id: m.id,
      manager: personRef(m.manager),
      employee: { ...personRef(m.employee)!, department: m.employee?.department?.name ?? null },
      scheduledAt: m.scheduledAt,
      durationMinutes: m.durationMinutes,
      status: m.status,
      overdue: m.status === 'SCHEDULED' && m.scheduledAt.getTime() < Date.now(),
    };
  }

  private async itemCounts(ids: string[]) {
    const out = new Map<string, { topics: number; openActions: number }>();
    if (!ids.length) return out;
    const items = await OneOnOneItem.findAll({ where: { meetingId: ids }, attributes: ['meetingId', 'kind', 'done'] });
    for (const i of items) {
      const c = out.get(i.meetingId) ?? { topics: 0, openActions: 0 };
      if (i.kind === 'TOPIC') c.topics += 1;
      else if (!i.done) c.openActions += 1;
      out.set(i.meetingId, c);
    }
    return out;
  }

  private async when(auth: AuthContext, at: Date) {
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['timezone'] });
    const { date, minutes } = zonedParts(at, org?.timezone ?? 'UTC');
    return `${date} at ${minutesToTime(minutes)}`;
  }

  private async notify(auth: AuthContext, employeeId: string, meetingId: string, title: string, transaction: Transaction, body?: string) {
    const userId = (await userIdsOf([employeeId], transaction)).get(employeeId);
    if (userId && userId !== auth.userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.one_on_one', title, body, link: `/me/performance/one-on-ones/${meetingId}` }, transaction);
  }
}
