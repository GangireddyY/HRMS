import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import { REGULARIZATION_WINDOW_DAYS, WFH_MAX_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, Employee, User, WorkFromHomeRequest } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceRulesService } from './attendance-rules.service';
import type { CreateWorkFromHomeDto, ReviewDto, WorkFromHomeQueryDto } from './dto/attendance.dto';

const range = (r: { startDate: string; endDate: string }) => (r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`);

/**
 * Work from home: employees ask for a range of days (`attendance.wfh.apply`); someone with
 * `attendance.regularize.approve` in scope — never the employee — approves or rejects. On approved days the office
 * geofence doesn't apply and attendance is recorded as remote.
 */
@Injectable()
export class WorkFromHomeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: AuthContext, dto: CreateWorkFromHomeDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    if (self.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const ctx = await this.rules.context(auth.organizationId!, self);
    const today = this.rules.today(ctx.timeZone);
    if (dto.endDate < dto.startDate) throw AppError.validation([{ field: 'endDate', message: "The last day can't be before the first" }]);
    if (addDays(dto.startDate, WFH_MAX_DAYS - 1) < dto.endDate) throw AppError.validation([{ field: 'endDate', message: `Ask for at most ${WFH_MAX_DAYS} days at a time` }]);
    if (dto.startDate < addDays(today, -REGULARIZATION_WINDOW_DAYS)) throw AppError.validation([{ field: 'startDate', message: `Requests are accepted for the last ${REGULARIZATION_WINDOW_DAYS} days at most` }]);
    if (dto.endDate > addDays(today, 90)) throw AppError.validation([{ field: 'endDate', message: 'Ask at most three months ahead' }]);
    if (dto.startDate < self.dateOfJoining) throw AppError.validation([{ field: 'startDate', message: 'This is before your date of joining' }]);
    await this.rules.assertOpen(dto.startDate);
    await this.rules.assertOpen(dto.endDate);
    const id = await this.db.transaction(async (transaction) => {
      const clash = await WorkFromHomeRequest.findOne({ where: { employeeId: self.id, status: ['PENDING', 'APPROVED'], startDate: { [Op.lte]: dto.endDate }, endDate: { [Op.gte]: dto.startDate } }, transaction });
      if (clash) throw AppError.conflict(`You already have ${clash.status === 'PENDING' ? 'a pending' : 'an approved'} request for ${range(clash)}`);
      const r = await WorkFromHomeRequest.create({ organizationId: auth.organizationId!, employeeId: self.id, startDate: dto.startDate, endDate: dto.endDate, reason: dto.reason, requestedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'attendance.wfh_requested', entityType: 'WorkFromHomeRequest', entityId: r.id, summary: `Work from home requested for ${range(r)}` }, transaction);
      const managerUser = self.managerId ? (await userIdsOf([self.managerId], transaction)).get(self.managerId) : undefined;
      if (managerUser && managerUser !== auth.userId) {
        await this.notifications.notify(managerUser, { organizationId: auth.organizationId, type: 'attendance.wfh', title: `${fullName(self)} asked to work from home (${range(r)})`, body: dto.reason, link: '/hr/attendance/regularizations?tab=wfh' }, transaction);
      }
      return r.id;
    });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: WorkFromHomeQueryDto) {
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, 'attendance.regularize.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped);
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await WorkFromHomeRequest.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }],
      order: [[literal(`CASE WHEN "WorkFromHomeRequest"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'], ['startDate', 'DESC']],
      ...paginationArgs(query),
    });
    const reviewers = await this.names(rows.map((r) => r.reviewedById));
    return new PaginatedResult(rows.map((r) => this.present(r, reviewers, self?.id ?? null)), paginationMeta(query, count));
  }

  async approve(auth: AuthContext, id: string, dto: ReviewDto) {
    await this.review(auth, id, async (r, employee, transaction) => {
      await r.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      // Days already punched become remote days.
      await AttendanceRecord.update({ workMode: 'REMOTE' }, { where: { employeeId: r.employeeId, workDate: { [Op.between]: [r.startDate, r.endDate] } }, transaction });
      await this.audit.record({ action: 'attendance.wfh_approved', entityType: 'WorkFromHomeRequest', entityId: id, summary: `Work from home of ${fullName(employee)} for ${range(r)} approved` }, transaction);
      await this.tell(r, `Work from home for ${range(r)} approved`, dto.note ?? undefined, auth, transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewDto) {
    if (!dto.note || dto.note.trim().length < 3) throw AppError.validation([{ field: 'note', message: 'Give a reason' }]);
    await this.review(auth, id, async (r, employee, transaction) => {
      await r.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record({ action: 'attendance.wfh_rejected', entityType: 'WorkFromHomeRequest', entityId: id, summary: `Work from home of ${fullName(employee)} for ${range(r)} rejected` }, transaction);
      await this.tell(r, `Work from home for ${range(r)} was not approved`, dto.note ?? undefined, auth, transaction);
    });
    return this.get(auth, id);
  }

  /** The employee withdraws a pending request, or an approved one that hasn't started yet. */
  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const r = await WorkFromHomeRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || !self || r.employeeId !== self.id) throw AppError.notFound('Request');
      const today = this.rules.today((await this.rules.context(auth.organizationId!, self)).timeZone);
      if (r.status !== 'PENDING' && !(r.status === 'APPROVED' && r.startDate > today)) throw AppError.conflict('Only pending requests, or approved ones that have not started, can be withdrawn');
      await r.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'attendance.wfh_cancelled', entityType: 'WorkFromHomeRequest', entityId: id, summary: `Work from home for ${range(r)} withdrawn` }, transaction);
    });
    return this.get(auth, id);
  }

  private async get(auth: AuthContext, id: string) {
    const r = (await WorkFromHomeRequest.findByPk(id, { include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }] }))!;
    const self = await this.scope.self(auth);
    return this.present(r, await this.names([r.reviewedById]), self?.id ?? null);
  }

  private async review(auth: AuthContext, id: string, fn: (r: WorkFromHomeRequest, employee: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const r = await WorkFromHomeRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r) throw AppError.notFound('Request');
      const employee = (await Employee.findByPk(r.employeeId, { attributes: ['id', 'organizationId', 'firstName', 'lastName', 'employeeCode', 'managerId', 'departmentId', 'membershipId'], transaction }))!;
      if (!(await this.scope.covers(auth, 'attendance.regularize.approve', employee))) throw AppError.notFound('Request');
      if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own request");
      if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
      await fn(r, employee, transaction);
    });
  }

  private async tell(r: WorkFromHomeRequest, title: string, body: string | undefined, auth: AuthContext, transaction: Transaction) {
    if (!r.requestedById || r.requestedById === auth.userId) return;
    await this.notifications.notify(r.requestedById, { organizationId: auth.organizationId, type: 'attendance.wfh', title, body, link: '/me/attendance' }, transaction);
  }

  private present(r: WorkFromHomeRequest, reviewers: Map<string, string>, selfId: string | null) {
    return {
      id: r.id,
      startDate: r.startDate,
      endDate: r.endDate,
      reason: r.reason,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (reviewers.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null,
      permissions: { review: r.status === 'PENDING' && r.employeeId !== selfId, cancel: r.employeeId === selfId && (r.status === 'PENDING' || r.status === 'APPROVED') },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
