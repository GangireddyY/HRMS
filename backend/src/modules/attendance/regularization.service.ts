import { Injectable } from '@nestjs/common';
import { literal, Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import { REGULARIZATION_WINDOW_DAYS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, AttendanceRegularization, Employee, OrganizationMembership, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { managerAndCover } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendanceRulesService } from './attendance-rules.service';
import type { CreateRegularizationDto, RegularizationQueryDto, ReviewDto } from './dto/attendance.dto';
import { OvertimeService } from './overtime.service';
import { fullName } from '../../common/utils/names';

function present(r: AttendanceRegularization, reviewers: Map<string, string>) {
  return {
    id: r.id,
    workDate: r.workDate,
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    reason: r.reason,
    status: r.status,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedById ? (reviewers.get(r.reviewedById) ?? null) : null,
    createdAt: r.createdAt,
    employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null,
  };
}

/** Requests to correct a day's punch times, approved by someone with attendance.regularize.approve in scope. */
@Injectable()
export class RegularizationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly notifications: NotificationsService,
    private readonly overtime: OvertimeService,
  ) {}

  async create(auth: AuthContext, dto: CreateRegularizationDto) {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    const ctx = await this.rules.context(auth.organizationId!, self);
    const today = this.rules.today(ctx.timeZone);
    if (dto.workDate > today) throw AppError.validation([{ field: 'workDate', message: 'You can only regularize past days or today' }]);
    if (dto.workDate < addDays(today, -REGULARIZATION_WINDOW_DAYS))
      throw AppError.validation([{ field: 'workDate', message: `Requests are accepted for the last ${REGULARIZATION_WINDOW_DAYS} days only` }]);
    if (dto.workDate < self.dateOfJoining) throw AppError.validation([{ field: 'workDate', message: 'This date is before your date of joining' }]);
    await this.rules.assertOpen(dto.workDate);
    const { checkInAt, checkOutAt } = this.rules.instants(dto.workDate, dto.checkIn, dto.checkOut, ctx.timeZone);
    if (checkOutAt! > new Date()) throw AppError.validation([{ field: 'checkOut', message: 'Check-out cannot be in the future' }]);

    let request: AttendanceRegularization;
    try {
      request = await this.db.transaction(async (transaction) => {
        const created = await AttendanceRegularization.create(
          { organizationId: auth.organizationId!, employeeId: self.id, workDate: dto.workDate, checkInAt, checkOutAt: checkOutAt!, reason: dto.reason, requestedById: auth.userId },
          { transaction },
        );
        await this.audit.record(
          { action: 'attendance.regularization_requested', entityType: 'AttendanceRegularization', entityId: created.id, summary: `Regularization requested for ${dto.workDate}` },
          transaction,
        );
        return created;
      });
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw AppError.conflict('You already have a pending request for this day. Cancel it to submit a new one.');
      throw e;
    }

    for (const approver of await managerAndCover(self.managerId)) {
      if (approver === auth.userId) continue;
      await this.notifications.notify(approver, {
        organizationId: auth.organizationId,
        type: 'attendance.regularization',
        title: `${fullName(self)} asked to regularize ${dto.workDate}`,
        body: dto.reason,
        link: '/hr/attendance/regularizations',
      });
    }
    return this.get(request.id);
  }

  async list(auth: AuthContext, query: RegularizationQueryDto) {
    const filters: WhereOptions[] = [];
    const self = await this.scope.self(auth);
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, 'attendance.regularize.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped);
      // Approvers never act on their own requests.
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await AttendanceRegularization.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }],
      order: [
        [literal(`CASE WHEN "AttendanceRegularization"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['workDate', 'DESC'],
        ['createdAt', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const reviewers = await this.reviewerNames(rows);
    return new PaginatedResult(
      rows.map((r) => present(r, reviewers)),
      paginationMeta(query, count),
    );
  }

  async approve(auth: AuthContext, id: string, dto: ReviewDto) {
    const { request, employee } = await this.forReview(auth, id);
    await this.rules.assertOpen(request.workDate);
    const ctx = await this.rules.context(auth.organizationId!, employee, { from: request.workDate, to: request.workDate });
    await this.db.transaction(async (transaction) => {
      const values = {
        ...(await this.rules.evaluate(ctx, request.workDate, request.checkInAt, request.checkOutAt, transaction)),
        checkInAt: request.checkInAt,
        checkOutAt: request.checkOutAt,
        source: 'REGULARIZED' as const,
        note: request.reason,
        updatedById: auth.userId,
      };
      const existing = await AttendanceRecord.findOne({ where: { employeeId: employee.id, workDate: request.workDate }, transaction });
      const saved = existing
        ? await existing.update(values, { transaction })
        : await AttendanceRecord.create({ ...values, organizationId: auth.organizationId!, employeeId: employee.id, workDate: request.workDate }, { transaction });
      await this.overtime.sync(saved, transaction);
      await request.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record(
        { action: 'attendance.regularization_approved', entityType: 'AttendanceRegularization', entityId: id, summary: `Regularization for ${fullName(employee)} on ${request.workDate} approved` },
        transaction,
      );
    });
    await this.notifyRequester(request, auth, 'approved', dto.note);
    return this.get(id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewDto) {
    const { request, employee } = await this.forReview(auth, id);
    await this.db.transaction(async (transaction) => {
      await request.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record(
        { action: 'attendance.regularization_rejected', entityType: 'AttendanceRegularization', entityId: id, summary: `Regularization for ${fullName(employee)} on ${request.workDate} rejected` },
        transaction,
      );
    });
    await this.notifyRequester(request, auth, 'rejected', dto.note);
    return this.get(id);
  }

  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    const request = await AttendanceRegularization.findByPk(id);
    if (!request || !self || request.employeeId !== self.id) throw AppError.notFound('Request');
    if (request.status !== 'PENDING') throw AppError.conflict('Only pending requests can be cancelled');
    await this.db.transaction(async (transaction) => {
      await request.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'attendance.regularization_cancelled', entityType: 'AttendanceRegularization', entityId: id }, transaction);
    });
    return this.get(id);
  }

  private async get(id: string) {
    const r = await AttendanceRegularization.findByPk(id, { include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }] });
    return present(r!, await this.reviewerNames([r!]));
  }

  private async forReview(auth: AuthContext, id: string) {
    const request = await AttendanceRegularization.findByPk(id);
    if (!request) throw AppError.notFound('Request');
    const employee = await Employee.findByPk(request.employeeId, {
      attributes: ['id', 'organizationId', 'firstName', 'lastName', 'employeeCode', 'managerId', 'departmentId', 'membershipId', 'shiftId', 'locationId', 'dateOfJoining', 'exitDate'],
    });
    if (!employee || !(await this.scope.covers(auth, 'attendance.regularize.approve', employee))) throw AppError.notFound('Request');
    if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden('You cannot review your own request');
    if (request.status !== 'PENDING') throw AppError.conflict(`This request is already ${request.status.toLowerCase()}`);
    return { request, employee };
  }

  private async managerUserId(employee: Employee): Promise<string | null> {
    if (!employee.managerId) return null;
    const manager = await Employee.findByPk(employee.managerId, { attributes: ['membershipId'] });
    if (!manager?.membershipId) return null;
    const membership = await OrganizationMembership.findByPk(manager.membershipId, { attributes: ['userId', 'status'] });
    return membership?.status === 'ACTIVE' ? membership.userId : null;
  }

  private async notifyRequester(request: AttendanceRegularization, auth: AuthContext, outcome: 'approved' | 'rejected', note?: string | null) {
    if (!request.requestedById || request.requestedById === auth.userId) return;
    await this.notifications.notify(request.requestedById, {
      organizationId: auth.organizationId,
      type: 'attendance.regularization',
      title: `Your regularization for ${request.workDate} was ${outcome}`,
      body: note ?? undefined,
      link: '/me/attendance',
    });
  }

  private async reviewerNames(rows: AttendanceRegularization[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    return new Map((await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
