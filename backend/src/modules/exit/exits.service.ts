import { Injectable } from '@nestjs/common';
import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { DEFAULT_CLEARANCE, DEFAULT_NOTICE_DAYS, OPEN_EXIT_STATUSES, type EmployeeStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { Department, Designation, Employee, EmployeeLifecycleEvent, ExitCase, ExitClearanceItem, ExitSettlement, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, organizationToday, userIdsOf, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ApproveExitDto, ClearanceItemDto, CloseExitDto, ExitQueryDto, FeedbackDto, InitiateExitDto, ResignDto, UpdateClearanceDto, UpdateExitDto } from './dto/exit.dto';
import { letterBlocker, noticeEnd, noticeShortfall, serviceLength } from './exit-rules';

const PERSON = ['id', 'employeeCode', 'firstName', 'lastName', 'departmentId', 'designationId', 'managerId', 'dateOfJoining', 'status', 'employmentType', 'noticePeriodDays', 'membershipId'];
const personInclude = () => [
  { model: Department, attributes: ['id', 'name'] },
  { model: Designation, attributes: ['id', 'name'] },
];

/** How the caller relates to an exit case. */
interface Access {
  self: boolean;
  manage: boolean;
  approve: boolean;
  clear: boolean;
  settle: boolean;
}

/**
 * Exits: an employee resigns (`exit.resign`) and their manager (`exit.approve` in scope) or HR (`exit.manage`) accepts
 * it with a last working day — never their own; HR can also record employer-initiated exits. While the employee serves
 * notice (status ON_NOTICE, exit date = last working day, so payroll prorates the final month) clearance steps are
 * worked through (`exit.clearance.manage`; handover by the manager). HR completes the exit on or after the last working
 * day (status EXITED) or cancels it. The full & final settlement is in SettlementsService.
 */
@Injectable()
export class ExitsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Employee ---------------------------------------------------------------------------------

  async resign(auth: AuthContext, dto: ResignDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.forbidden('Only employees can resign');
    if (self.status !== 'ACTIVE') throw AppError.conflict(self.status === 'ON_NOTICE' ? 'You are already serving notice' : 'You have exited the organization');
    const today = await organizationToday(auth.organizationId!);
    if (dto.requestedLastDay && dto.requestedLastDay < today) throw AppError.validation([{ field: 'requestedLastDay', message: "The last day can't be in the past" }]);
    if (dto.requestedLastDay && dto.requestedLastDay > addDays(today, 365)) throw AppError.validation([{ field: 'requestedLastDay', message: 'Choose a day within a year' }]);
    const noticeDays = self.noticePeriodDays ?? DEFAULT_NOTICE_DAYS;
    const id = await this.db.transaction(async (transaction) => {
      if (await ExitCase.count({ where: { employeeId: self.id, status: OPEN_EXIT_STATUSES }, transaction })) throw AppError.conflict('You have already resigned');
      const c = await ExitCase.create(
        {
          organizationId: auth.organizationId!,
          employeeId: self.id,
          type: 'RESIGNATION',
          reason: dto.reason,
          reasonDetail: dto.reasonDetail ?? null,
          status: 'SUBMITTED',
          submittedOn: today,
          noticeDays,
          noticeEndsOn: noticeEnd(today, noticeDays),
          requestedLastDay: dto.requestedLastDay ?? null,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record({ action: 'exit.resigned', entityType: 'ExitCase', entityId: c.id, summary: `${self.employeeCode} resigned` }, transaction);
      const recipients = new Set(await usersWithPermission('exit.manage', transaction));
      if (self.managerId) {
        const managerUser = (await userIdsOf([self.managerId], transaction)).get(self.managerId);
        if (managerUser) recipients.add(managerUser);
      }
      recipients.delete(auth.userId);
      for (const userId of recipients) {
        await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'exit.resignation', title: `${fullName(self)} has resigned`, body: `Notice period ends ${c.noticeEndsOn}.`, link: `/hr/exits/${c.id}` }, transaction);
      }
      return c.id;
    });
    return this.get(auth, id);
  }

  async mine(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { current: null, history: [] };
    const cases = await ExitCase.findAll({ where: { employeeId: self.id }, order: [['createdAt', 'DESC']] });
    const open = cases.find((c) => c.status === 'SUBMITTED' || c.status === 'APPROVED' || c.status === 'COMPLETED');
    return {
      current: open ? await this.get(auth, open.id) : null,
      history: cases.filter((c) => c !== open).map((c) => ({ id: c.id, type: c.type, status: c.status, submittedOn: c.submittedOn, lastWorkingDay: c.lastWorkingDay, closedReason: c.closedReason })),
    };
  }

  async withdraw(auth: AuthContext, id: string) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.self) throw AppError.forbidden('Only the employee can withdraw their resignation');
      if (c.status !== 'SUBMITTED') throw AppError.conflict('Your resignation has been accepted; ask HR to cancel it');
      await c.update({ status: 'WITHDRAWN', closedAt: new Date(), closedReason: 'Withdrawn by the employee' }, { transaction });
      await this.audit.record({ action: 'exit.withdrawn', entityType: 'ExitCase', entityId: c.id, summary: 'Resignation withdrawn' }, transaction);
    });
    return this.get(auth, id);
  }

  async feedback(auth: AuthContext, id: string, dto: FeedbackDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.self) throw AppError.forbidden();
      if (c.status !== 'APPROVED' && c.status !== 'COMPLETED') throw AppError.conflict('The exit survey opens once your exit is confirmed');
      if (c.feedback) throw AppError.conflict('You have already shared your feedback');
      await c.update({ feedback: { submittedAt: new Date().toISOString(), wouldRecommend: dto.wouldRecommend, wouldRejoin: dto.wouldRejoin, liked: dto.liked ?? null, improve: dto.improve ?? null } }, { transaction });
      await this.audit.record({ action: 'exit.feedback_given', entityType: 'ExitCase', entityId: c.id, summary: 'Exit survey submitted' }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- HR & managers ----------------------------------------------------------------------------

  /** Employer-initiated exits (termination, retirement, end of contract, death…), confirmed straight away. */
  async initiate(auth: AuthContext, dto: InitiateExitDto) {
    const employee = await Employee.findByPk(dto.employeeId);
    if (!employee) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden("You can't record your own exit");
    if (employee.status !== 'ACTIVE') throw AppError.conflict(employee.status === 'ON_NOTICE' ? `${fullName(employee)} is already serving notice` : `${fullName(employee)} has exited`);
    const problems = this.lastDayProblems(dto.lastWorkingDay, dto.noticeGivenOn, employee.dateOfJoining);
    if (problems.length) throw AppError.validation(problems);
    const noticeDays = dto.noticeDays ?? employee.noticePeriodDays ?? DEFAULT_NOTICE_DAYS;
    const id = await this.db.transaction(async (transaction) => {
      if (await ExitCase.count({ where: { employeeId: employee.id, status: OPEN_EXIT_STATUSES }, transaction })) throw AppError.conflict(`${fullName(employee)} already has an open exit`);
      const c = await ExitCase.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          type: dto.type,
          reason: dto.reason,
          reasonDetail: dto.reasonDetail ?? null,
          status: 'APPROVED',
          submittedOn: dto.noticeGivenOn,
          noticeDays,
          noticeEndsOn: noticeEnd(dto.noticeGivenOn, noticeDays),
          lastWorkingDay: dto.lastWorkingDay,
          noticeWaived: !!dto.waiveNotice,
          decidedById: auth.userId,
          decidedAt: new Date(),
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.startNotice(c, employee, auth, transaction);
      await this.audit.record({ action: 'exit.initiated', entityType: 'ExitCase', entityId: c.id, summary: `${dto.type.toLowerCase().replace('_', ' ')} of ${employee.employeeCode} recorded; last working day ${dto.lastWorkingDay}` }, transaction);
      return c.id;
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: ExitQueryDto) {
    const self = await this.scope.self(auth);
    const conditions: WhereOptions[] = [];
    if (query.view === 'approve') {
      const scoped = auth.permissions.has('exit.manage') ? {} : await this.scope.where(auth, 'exit.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped, { status: 'SUBMITTED' });
      if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
    } else {
      const scoped = auth.permissions.has('exit.manage') || auth.permissions.has('exit.clearance.manage') ? {} : await this.scope.where(auth, 'exit.view', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
      if (self && !auth.permissions.has('exit.manage')) conditions.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status === 'OPEN') conditions.push({ status: OPEN_EXIT_STATUSES });
    else if (query.status) conditions.push({ status: query.status });
    const like = query.search ? containsPattern(query.search) : null;
    const employeeWhere = like ? { [Op.or]: [{ firstName: { [Op.iLike]: like } }, { lastName: { [Op.iLike]: like } }, { employeeCode: { [Op.iLike]: like } }] } : undefined;
    const where = { [Op.and]: conditions };
    const count = await ExitCase.count({ where, include: [{ model: Employee, where: employeeWhere, required: !!like }] });
    const rows = await ExitCase.findAll({
      where,
      include: [{ model: Employee, attributes: PERSON, where: employeeWhere, required: !!like, include: personInclude() }, { model: ExitClearanceItem, attributes: ['status'] }],
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
    });
    const settlements = auth.permissions.has('payroll.settlement.manage') && rows.length ? await ExitSettlement.findAll({ where: { caseId: rows.map((r) => r.id) }, attributes: ['caseId', 'status', 'netPayable', 'dueOn'] }) : [];
    const today = await organizationToday(auth.organizationId!);
    return new PaginatedResult(
      rows.map((c) => ({ ...this.summary(c, today), settlement: this.settlementSummary(settlements.find((s) => s.caseId === c.id), today) })),
      paginationMeta(query, count),
    );
  }

  async get(auth: AuthContext, id: string) {
    const c = await this.find(id);
    const access = await this.access(auth, c);
    return this.present(auth, c, access);
  }

  async approve(auth: AuthContext, id: string, dto: ApproveExitDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (access.self) throw AppError.forbidden("You can't accept your own resignation");
      if (!access.approve && !access.manage) throw AppError.forbidden();
      if (c.status !== 'SUBMITTED') throw AppError.conflict('Only a submitted resignation can be accepted');
      const employee = (await Employee.findByPk(c.employeeId, { transaction }))!;
      const problems = this.lastDayProblems(dto.lastWorkingDay, c.submittedOn, employee.dateOfJoining);
      if (problems.length) throw AppError.validation(problems);
      await c.update({ status: 'APPROVED', lastWorkingDay: dto.lastWorkingDay, noticeWaived: !!dto.waiveNotice, decidedById: auth.userId, decidedAt: new Date(), decisionNote: dto.note ?? null }, { transaction });
      await this.startNotice(c, employee, auth, transaction);
      await this.audit.record({ action: 'exit.accepted', entityType: 'ExitCase', entityId: c.id, summary: `Resignation of ${employee.employeeCode} accepted; last working day ${dto.lastWorkingDay}` }, transaction);
      const userId = (await userIdsOf([employee.id], transaction)).get(employee.id);
      if (userId) {
        await this.notifications.notify(userId, { organizationId: c.organizationId, type: 'exit.resignation', title: 'Your resignation has been accepted', body: `Your last working day is ${dto.lastWorkingDay}.`, link: '/me/exit' }, transaction);
      }
    });
    return this.get(auth, id);
  }

  async update(auth: AuthContext, id: string, dto: UpdateExitDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.manage || access.self) throw AppError.forbidden();
      const changes: Partial<ExitCase> = {};
      if (dto.lastWorkingDay !== undefined || dto.waiveNotice !== undefined) {
        if (c.status !== 'APPROVED') throw AppError.conflict('The last working day can only change while notice is being served');
        if (await this.settlementLocked(c.id, transaction)) throw AppError.conflict('The settlement has been submitted; send it back before changing the exit');
        if (dto.lastWorkingDay !== undefined) {
          const employee = (await Employee.findByPk(c.employeeId, { transaction }))!;
          const problems = this.lastDayProblems(dto.lastWorkingDay, c.submittedOn, employee.dateOfJoining);
          if (problems.length) throw AppError.validation(problems);
          changes.lastWorkingDay = dto.lastWorkingDay;
          await employee.update({ exitDate: dto.lastWorkingDay, updatedById: auth.userId }, { transaction });
        }
        if (dto.waiveNotice !== undefined) changes.noticeWaived = dto.waiveNotice;
      }
      if (dto.eligibleForRehire !== undefined) changes.eligibleForRehire = dto.eligibleForRehire;
      if (dto.rehireNote !== undefined) changes.rehireNote = dto.rehireNote;
      await c.update(changes, { transaction });
      await this.audit.record({ action: 'exit.updated', entityType: 'ExitCase', entityId: c.id, summary: 'Exit details updated', metadata: { fields: Object.keys(changes) } }, transaction);
    });
    return this.get(auth, id);
  }

  async addClearance(auth: AuthContext, id: string, dto: ClearanceItemDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.manage && !access.clear) throw AppError.forbidden();
      if (c.status !== 'APPROVED') throw AppError.conflict('Clearance happens while notice is being served');
      const last = Number((await ExitClearanceItem.max('sortOrder', { where: { caseId: c.id }, transaction })) ?? 0);
      await ExitClearanceItem.create({ organizationId: c.organizationId, caseId: c.id, department: dto.department, title: dto.title, sortOrder: last + 1 }, { transaction });
    });
    return this.get(auth, id);
  }

  async updateClearance(auth: AuthContext, id: string, itemId: string, dto: UpdateClearanceDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      const item = await ExitClearanceItem.findOne({ where: { id: itemId, caseId: c.id }, transaction });
      if (!item) throw AppError.notFound('Clearance step');
      if (access.self) throw AppError.forbidden("You can't clear your own exit");
      if (!access.manage && !access.clear && !(access.approve && item.department === 'MANAGER')) throw AppError.forbidden();
      if (c.status !== 'APPROVED') throw AppError.conflict('Clearance happens while notice is being served');
      if (await this.settlementLocked(c.id, transaction)) throw AppError.conflict('The settlement has been submitted; send it back before changing recoveries');
      await item.update(
        {
          status: dto.status,
          ...(dto.recoveryAmount !== undefined ? { recoveryAmount: String(dto.recoveryAmount) } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          clearedById: dto.status === 'PENDING' ? null : auth.userId,
          clearedAt: dto.status === 'PENDING' ? null : new Date(),
        },
        { transaction },
      );
      await this.audit.record({ action: 'exit.clearance_updated', entityType: 'ExitCase', entityId: c.id, summary: `Clearance "${item.title}" ${dto.status.toLowerCase().replace('_', ' ')}`, metadata: { recoveryAmount: dto.recoveryAmount } }, transaction);
    });
    return this.get(auth, id);
  }

  /** On or after the last working day, with every clearance step done: the employee has exited. */
  async complete(auth: AuthContext, id: string) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.manage || access.self) throw AppError.forbidden();
      const blocker = await this.completeBlocker(c, transaction);
      if (blocker) throw AppError.conflict(blocker);
      const employee = (await Employee.findByPk(c.employeeId, { transaction }))!;
      await c.update({ status: 'COMPLETED', completedAt: new Date(), completedById: auth.userId }, { transaction });
      await this.setStatus(employee, 'EXITED', c.lastWorkingDay!, c.lastWorkingDay!, `Exit completed (${c.type.toLowerCase().replace('_', ' ')})`, auth, transaction);
      await this.audit.record({ action: 'exit.completed', entityType: 'ExitCase', entityId: c.id, summary: `${employee.employeeCode} exited on ${c.lastWorkingDay}` }, transaction);
    });
    return this.get(auth, id);
  }

  async cancel(auth: AuthContext, id: string, dto: CloseExitDto) {
    await this.mutate(auth, id, async (c, access, transaction) => {
      if (!access.manage || access.self) throw AppError.forbidden();
      if (c.status !== 'SUBMITTED' && c.status !== 'APPROVED') throw AppError.conflict('Only an open exit can be cancelled');
      if (await this.settlementLocked(c.id, transaction)) throw AppError.conflict('The settlement has been submitted; send it back first');
      await ExitSettlement.destroy({ where: { caseId: c.id }, transaction });
      const wasServing = c.status === 'APPROVED';
      await c.update({ status: 'CANCELLED', closedAt: new Date(), closedReason: dto.reason }, { transaction });
      const employee = (await Employee.findByPk(c.employeeId, { transaction }))!;
      if (wasServing && employee.status === 'ON_NOTICE') await this.setStatus(employee, 'ACTIVE', null, await organizationToday(c.organizationId), `Exit cancelled: ${dto.reason}`, auth, transaction);
      await this.audit.record({ action: 'exit.cancelled', entityType: 'ExitCase', entityId: c.id, summary: `Exit of ${employee.employeeCode} cancelled` }, transaction);
    });
    return this.get(auth, id);
  }

  // ---- Internals --------------------------------------------------------------------------------

  async find(id: string, transaction?: Transaction) {
    const c = await ExitCase.findByPk(id, { transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    if (!c) throw AppError.notFound('Exit');
    return c;
  }

  async access(auth: AuthContext, c: ExitCase): Promise<Access> {
    const self = await this.scope.self(auth);
    const employee = (await Employee.findByPk(c.employeeId, { attributes: ['id', 'managerId', 'departmentId'] }))!;
    const isSelf = self?.id === c.employeeId;
    const a: Access = {
      self: isSelf,
      manage: !isSelf && auth.permissions.has('exit.manage'),
      approve: !isSelf && (await this.scope.covers(auth, 'exit.approve', employee)),
      clear: !isSelf && auth.permissions.has('exit.clearance.manage'),
      settle: !isSelf && auth.permissions.has('payroll.settlement.manage'),
    };
    const viewer = !isSelf && (await this.scope.covers(auth, 'exit.view', employee));
    if (!a.self && !a.manage && !a.approve && !a.clear && !a.settle && !viewer) throw AppError.notFound('Exit');
    return a;
  }

  private async mutate(auth: AuthContext, id: string, fn: (c: ExitCase, access: Access, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const c = await this.find(id, transaction);
      await fn(c, await this.access(auth, c), transaction);
    });
  }

  private lastDayProblems(lastWorkingDay: string, from: string, joined: string) {
    const problems: { field: string; message: string }[] = [];
    if (lastWorkingDay < from) problems.push({ field: 'lastWorkingDay', message: "The last working day can't be before notice was given" });
    if (lastWorkingDay < joined) problems.push({ field: 'lastWorkingDay', message: "The last working day can't be before the joining date" });
    if (lastWorkingDay > addDays(from, 365)) problems.push({ field: 'lastWorkingDay', message: 'Choose a day within a year of the notice' });
    return problems;
  }

  /** Serving notice: status ON_NOTICE, exit date = last working day (payroll prorates the final month), clearance steps. */
  private async startNotice(c: ExitCase, employee: Employee, auth: AuthContext, transaction: Transaction) {
    await this.setStatus(employee, 'ON_NOTICE', c.lastWorkingDay!, c.submittedOn > employee.dateOfJoining ? c.submittedOn : employee.dateOfJoining, `${c.type === 'RESIGNATION' ? 'Resignation accepted' : 'Exit recorded'}; last working day ${c.lastWorkingDay}`, auth, transaction);
    await ExitClearanceItem.bulkCreate(DEFAULT_CLEARANCE.map((d, i) => ({ organizationId: c.organizationId, caseId: c.id, department: d.department, title: d.title, sortOrder: i })), { transaction });
  }

  private async setStatus(employee: Employee, status: EmployeeStatus, exitDate: string | null, effectiveDate: string, note: string, auth: AuthContext, transaction: Transaction) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (employee.status !== status) changes.status = { from: employee.status, to: status };
    if ((employee.exitDate ?? null) !== exitDate) changes.exitDate = { from: employee.exitDate ?? null, to: exitDate };
    await employee.update({ status, exitDate, updatedById: auth.userId }, { transaction });
    if (changes.status) {
      await EmployeeLifecycleEvent.create({ organizationId: employee.organizationId, employeeId: employee.id, type: 'STATUS_CHANGE', effectiveDate, changes, note: note.slice(0, 500), createdById: auth.userId }, { transaction });
    }
  }

  private async completeBlocker(c: ExitCase, transaction?: Transaction): Promise<string | null> {
    if (c.status !== 'APPROVED') return 'Only an exit that is serving notice can be completed';
    const today = await organizationToday(c.organizationId);
    if (c.lastWorkingDay! > today) return `The exit can be completed from the last working day (${c.lastWorkingDay})`;
    const pending = await ExitClearanceItem.count({ where: { caseId: c.id, status: 'PENDING' }, transaction });
    if (pending) return `${pending} clearance step${pending === 1 ? ' is' : 's are'} still pending`;
    return null;
  }

  private async settlementLocked(caseId: string, transaction: Transaction) {
    return (await ExitSettlement.count({ where: { caseId, status: { [Op.ne]: 'DRAFT' } }, transaction })) > 0;
  }

  private summary(c: ExitCase, today: string) {
    const e = c.employee;
    const clearance = c.clearance ?? [];
    return {
      id: c.id,
      employee: e
        ? { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department?.name ?? null, designation: e.designation?.name ?? null, dateOfJoining: e.dateOfJoining, employmentType: e.employmentType }
        : null,
      type: c.type,
      reason: c.reason,
      status: c.status,
      submittedOn: c.submittedOn,
      noticeDays: c.noticeDays,
      noticeEndsOn: c.noticeEndsOn,
      requestedLastDay: c.requestedLastDay,
      lastWorkingDay: c.lastWorkingDay,
      noticeWaived: c.noticeWaived,
      shortfallDays: noticeShortfall(c.noticeEndsOn, c.lastWorkingDay ?? c.requestedLastDay ?? c.noticeEndsOn, c.noticeWaived),
      daysLeft: c.status === 'APPROVED' && c.lastWorkingDay ? Math.max(0, Math.round((Date.parse(c.lastWorkingDay) - Date.parse(today)) / 86_400_000)) : null,
      clearance: { total: clearance.length, done: clearance.filter((i) => i.status !== 'PENDING').length },
      createdAt: c.createdAt,
    };
  }

  private settlementSummary(s: ExitSettlement | undefined, today: string) {
    return s ? { status: s.status, netPayable: Number(s.netPayable), dueOn: s.dueOn, overdue: s.status !== 'PAID' && today > s.dueOn } : null;
  }

  private async present(auth: AuthContext, c: ExitCase, access: Access) {
    const full = (await ExitCase.findByPk(c.id, { include: [{ model: Employee, attributes: PERSON, include: personInclude() }, { model: ExitClearanceItem }] }))!;
    const today = await organizationToday(full.organizationId);
    const items = [...(full.clearance ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const users = await this.names([full.decidedById, full.completedById, ...items.map((i) => i.clearedById)]);
    const settlement = access.settle || access.self ? await ExitSettlement.findOne({ where: { caseId: full.id } }) : null;
    const blocker = access.manage ? await this.completeBlocker(full) : null;
    const service = serviceLength(full.employee!.dateOfJoining, full.lastWorkingDay ?? today);
    return {
      ...this.summary(full, today),
      reasonDetail: full.reasonDetail,
      service,
      decidedBy: full.decidedById ? (users.get(full.decidedById) ?? 'Former user') : null,
      decidedAt: full.decidedAt,
      decisionNote: full.decisionNote,
      completedAt: full.completedAt,
      completedBy: full.completedById ? (users.get(full.completedById) ?? 'Former user') : null,
      closedReason: full.closedReason,
      closedAt: full.closedAt,
      clearanceItems: items.map((i) => ({
        id: i.id,
        department: i.department,
        title: i.title,
        status: i.status,
        recoveryAmount: Number(i.recoveryAmount),
        note: i.note,
        clearedBy: i.clearedById ? (users.get(i.clearedById) ?? 'Former user') : null,
        clearedAt: i.clearedAt,
      })),
      feedback: access.manage ? full.feedback : undefined,
      feedbackGiven: !!full.feedback,
      ...(access.manage ? { eligibleForRehire: full.eligibleForRehire, rehireNote: full.rehireNote } : {}),
      settlement: settlement && (access.settle || ['APPROVED', 'PAID'].includes(settlement.status)) ? this.settlementSummary(settlement, today) : null,
      permissions: {
        self: access.self,
        manage: access.manage,
        approve: (access.approve || access.manage) && full.status === 'SUBMITTED',
        clear: (access.manage || access.clear) && full.status === 'APPROVED',
        clearManager: (access.manage || access.clear || access.approve) && full.status === 'APPROVED',
        withdraw: access.self && full.status === 'SUBMITTED',
        feedback: access.self && (full.status === 'APPROVED' || full.status === 'COMPLETED') && !full.feedback,
        complete: access.manage && !blocker,
        completeBlocker: access.manage && full.status === 'APPROVED' ? blocker : null,
        cancel: access.manage && (full.status === 'SUBMITTED' || full.status === 'APPROVED'),
        settle: access.settle && (full.status === 'APPROVED' || full.status === 'COMPLETED'),
        letters: access.manage && !letterBlocker(full.status, full.type),
      },
    };
  }

  private async names(ids: (string | null | undefined)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
