import { Injectable } from '@nestjs/common';
import { Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../../database/database.service';
import { Department, Employee, PerformancePip, PerformanceReview, PipCheckIn, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AcknowledgeDto, CheckInDto, ClosePipDto, PipDto, PipQueryDto, UpdatePipDto } from './dto/performance.dto';
import { fullName, organizationToday, personRef, userIdsOf } from './performance-people';

const EMPLOYEE_ATTRS = ['id', 'employeeCode', 'firstName', 'lastName', 'managerId', 'departmentId', 'status'];

/**
 * Performance improvement plans: opened by someone with `performance.pip.manage` covering the employee (never for
 * themselves), with objectives, dated check-ins and a recorded outcome. The employee sees and acknowledges their plan.
 */
@Injectable()
export class PipsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(auth: AuthContext, query: PipQueryDto) {
    const self = await this.scope.self(auth);
    const conditions: WhereOptions[] = [];
    if ((query.view ?? 'managed') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, 'performance.pip.manage', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      conditions.push(scoped);
      if (self) conditions.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) conditions.push({ status: query.status });
    const { rows, count } = await PerformancePip.findAndCountAll({
      where: { [Op.and]: conditions },
      include: [
        { model: Employee, as: 'employee', attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: Employee, as: 'owner', attributes: ['id', 'employeeCode', 'firstName', 'lastName'] },
      ],
      order: [['status', 'ASC'], ['endDate', 'ASC']],
      ...paginationArgs(query),
    });
    const today = await organizationToday(auth.organizationId!);
    return new PaginatedResult(rows.map((p) => this.summary(p, today)), paginationMeta(query, count));
  }

  async get(auth: AuthContext, id: string) {
    const { pip, isSubject, canManage } = await this.access(auth, id);
    const checkIns = await PipCheckIn.findAll({ where: { pipId: id }, order: [['checkInDate', 'DESC'], ['createdAt', 'DESC']] });
    const names = await this.userNames([...checkIns.map((c) => c.createdById), pip.closedById, pip.createdById]);
    const today = await organizationToday(auth.organizationId!);
    return {
      ...this.summary(pip, today),
      reason: pip.reason,
      objectives: pip.objectives,
      reviewId: pip.reviewId,
      outcomeNote: pip.outcomeNote,
      closedAt: pip.closedAt,
      closedBy: pip.closedById ? (names.get(pip.closedById) ?? null) : null,
      createdBy: pip.createdById ? (names.get(pip.createdById) ?? null) : null,
      acknowledgedAt: pip.acknowledgedAt,
      employeeComment: pip.employeeComment,
      checkIns: checkIns.map((c) => ({ id: c.id, checkInDate: c.checkInDate, progress: c.progress, note: c.note, createdBy: c.createdById ? (names.get(c.createdById) ?? null) : null, createdAt: c.createdAt })),
      permissions: { manage: canManage && pip.status === 'ACTIVE', acknowledge: isSubject && !pip.acknowledgedAt },
    };
  }

  async create(auth: AuthContext, dto: PipDto) {
    const employee = await Employee.findByPk(dto.employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee) throw AppError.notFound('Employee');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden("You can't open an improvement plan for yourself");
    if (!(await this.scope.covers(auth, 'performance.pip.manage', employee))) throw AppError.notFound('Employee');
    if (employee.status !== 'ACTIVE') throw AppError.conflict(`${fullName(employee)} is not an active employee`);
    if (dto.endDate <= dto.startDate) throw AppError.validation([{ field: 'endDate', message: 'The plan must end after it starts' }]);
    if (dto.reviewId && !(await PerformanceReview.count({ where: { id: dto.reviewId, employeeId: employee.id } }))) {
      throw AppError.validation([{ field: 'reviewId', message: "The review doesn't belong to this employee" }]);
    }
    try {
      const pip = await this.db.transaction(async (transaction) => {
        const created = await PerformancePip.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            ownerId: self?.id ?? null,
            reviewId: dto.reviewId ?? null,
            reason: dto.reason,
            objectives: dto.objectives.map((o) => ({ title: o.title, measure: o.measure ?? null, met: null })),
            startDate: dto.startDate,
            endDate: dto.endDate,
            createdById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record({ action: 'performance.pip_opened', entityType: 'PerformancePip', entityId: created.id, summary: `Improvement plan opened for ${employee.employeeCode} (${dto.startDate} to ${dto.endDate})` }, transaction);
        await this.notify(auth, employee.id, created.id, 'An improvement plan has been opened for you', transaction);
        return created;
      });
      return this.get(auth, pip.id);
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict(`${fullName(employee)} already has an active improvement plan`);
      throw e;
    }
  }

  async update(auth: AuthContext, id: string, dto: UpdatePipDto) {
    const { pip } = await this.managed(auth, id);
    if (dto.endDate && dto.endDate <= pip.startDate) throw AppError.validation([{ field: 'endDate', message: 'The plan must end after it starts' }]);
    const extended = !!dto.endDate && dto.endDate !== pip.endDate;
    await this.db.transaction(async (transaction) => {
      await pip.update(
        {
          ...(dto.reason ? { reason: dto.reason } : {}),
          ...(dto.endDate ? { endDate: dto.endDate } : {}),
          ...(dto.objectives ? { objectives: dto.objectives.map((o) => ({ title: o.title, measure: o.measure ?? null, met: null })) } : {}),
        },
        { transaction },
      );
      await this.audit.record({ action: 'performance.pip_updated', entityType: 'PerformancePip', entityId: id, summary: extended ? `Improvement plan end date changed to ${dto.endDate}` : 'Improvement plan updated' }, transaction);
      if (extended) await this.notify(auth, pip.employeeId, id, `Your improvement plan now ends on ${dto.endDate}`, transaction);
    });
    return this.get(auth, id);
  }

  async checkIn(auth: AuthContext, id: string, dto: CheckInDto) {
    const { pip } = await this.managed(auth, id);
    const today = await organizationToday(auth.organizationId!);
    if (dto.checkInDate > today) throw AppError.validation([{ field: 'checkInDate', message: "A check-in can't be in the future" }]);
    if (dto.checkInDate < pip.startDate) throw AppError.validation([{ field: 'checkInDate', message: 'The check-in is before the plan started' }]);
    await this.db.transaction(async (transaction) => {
      await PipCheckIn.create({ organizationId: auth.organizationId!, pipId: id, checkInDate: dto.checkInDate, progress: dto.progress, note: dto.note, createdById: auth.userId }, { transaction });
      await this.audit.record({ action: 'performance.pip_check_in', entityType: 'PerformancePip', entityId: id, summary: `Improvement plan check-in (${dto.progress.toLowerCase().replace('_', ' ')})` }, transaction);
      await this.notify(auth, pip.employeeId, id, 'A check-in was added to your improvement plan', transaction);
    });
    return this.get(auth, id);
  }

  async close(auth: AuthContext, id: string, dto: ClosePipDto) {
    const { pip } = await this.managed(auth, id);
    if (dto.objectivesMet && dto.objectivesMet.length !== pip.objectives.length) throw AppError.validation([{ field: 'objectivesMet', message: 'Give an answer for every objective' }]);
    await this.db.transaction(async (transaction) => {
      await pip.update(
        {
          status: dto.outcome,
          outcomeNote: dto.note,
          closedAt: new Date(),
          closedById: auth.userId,
          objectives: pip.objectives.map((o, i) => ({ ...o, met: dto.objectivesMet ? dto.objectivesMet[i]! : o.met })),
        },
        { transaction },
      );
      await this.audit.record({ action: 'performance.pip_closed', entityType: 'PerformancePip', entityId: id, summary: `Improvement plan closed: ${dto.outcome.toLowerCase()}` }, transaction);
      await this.notify(auth, pip.employeeId, id, `Your improvement plan was closed (${dto.outcome === 'SUCCESSFUL' ? 'completed successfully' : dto.outcome === 'UNSUCCESSFUL' ? 'not met' : 'cancelled'})`, transaction);
    });
    return this.get(auth, id);
  }

  async acknowledge(auth: AuthContext, id: string, dto: AcknowledgeDto) {
    const { pip, isSubject } = await this.access(auth, id);
    if (!isSubject) throw AppError.forbidden();
    if (pip.acknowledgedAt) throw AppError.conflict('You have already acknowledged this plan');
    await this.db.transaction(async (transaction) => {
      await pip.update({ acknowledgedAt: new Date(), employeeComment: dto.comment ?? null }, { transaction });
      await this.audit.record({ action: 'performance.pip_acknowledged', entityType: 'PerformancePip', entityId: id, summary: 'Improvement plan acknowledged by the employee' }, transaction);
      if (pip.ownerId) {
        const userId = (await userIdsOf([pip.ownerId], transaction)).get(pip.ownerId);
        if (userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.pip', title: `${fullName(pip.employee!)} acknowledged their improvement plan`, body: dto.comment ?? undefined, link: `/hr/performance/pips/${id}` }, transaction);
      }
    });
    return this.get(auth, id);
  }

  private async access(auth: AuthContext, id: string) {
    const pip = await PerformancePip.findByPk(id, {
      include: [
        { model: Employee, as: 'employee', attributes: EMPLOYEE_ATTRS, include: [{ model: Department, attributes: ['id', 'name'] }] },
        { model: Employee, as: 'owner', attributes: ['id', 'employeeCode', 'firstName', 'lastName'] },
      ],
    });
    if (!pip) throw AppError.notFound('Improvement plan');
    const self = await this.scope.self(auth);
    const isSubject = self?.id === pip.employeeId;
    const canManage = !isSubject && (await this.scope.covers(auth, 'performance.pip.manage', pip.employee!));
    if (!isSubject && !canManage) throw AppError.notFound('Improvement plan');
    return { pip, isSubject, canManage };
  }

  private async managed(auth: AuthContext, id: string) {
    const a = await this.access(auth, id);
    if (!a.canManage) throw AppError.forbidden();
    if (a.pip.status !== 'ACTIVE') throw AppError.conflict('This improvement plan is closed');
    return a;
  }

  private summary(p: PerformancePip, today: string) {
    return {
      id: p.id,
      employee: { ...personRef(p.employee)!, department: p.employee?.department?.name ?? null },
      owner: personRef(p.owner),
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      overdue: p.status === 'ACTIVE' && p.endDate < today,
      objectivesCount: p.objectives.length,
      acknowledged: !!p.acknowledgedAt,
      createdAt: p.createdAt,
    };
  }

  private async notify(auth: AuthContext, employeeId: string, pipId: string, title: string, transaction: Transaction) {
    const userId = (await userIdsOf([employeeId], transaction)).get(employeeId);
    if (userId && userId !== auth.userId) await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'performance.pip', title, link: `/me/performance/pips/${pipId}` }, transaction);
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
