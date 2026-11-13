import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { DatabaseService } from '../../database/database.service';
import { AttendanceOvertime, AttendanceRecord, Employee, PayrollRun, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { fullName, userIdsOf } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { OvertimeQueryDto, ReviewOvertimeDto } from './dto/attendance.dto';

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;

/**
 * Overtime: when a completed record has overtime (see the shift's rules), an entry waits for approval by someone with
 * `attendance.regularize.approve` in scope — never the employee — who can approve fewer minutes. Approved overtime
 * is paid by the next payroll run. Changing the punches resets an undecided or decided (unpaid) entry to pending.
 */
@Injectable()
export class OvertimeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Keeps the overtime entry of a record in step with its punches. */
  /** `preloaded` = the day's overtime row (or null) when the caller already loaded it; undefined = look it up. */
  async sync(record: AttendanceRecord, transaction?: Transaction, preloaded?: AttendanceOvertime | null): Promise<void> {
    const existing = preloaded !== undefined ? preloaded : await AttendanceOvertime.findOne({ where: { employeeId: record.employeeId, workDate: record.workDate }, transaction });
    const minutes = record.overtimeMinutes ?? 0;
    if (existing?.payrollRunId) return;
    if (!minutes) {
      if (existing) await existing.destroy({ transaction });
      return;
    }
    if (!existing) {
      await AttendanceOvertime.create({ organizationId: record.organizationId, employeeId: record.employeeId, recordId: record.id, workDate: record.workDate, minutes }, { transaction });
    } else if (existing.minutes !== minutes || existing.recordId !== record.id) {
      await existing.update({ recordId: record.id, minutes, status: 'PENDING', approvedMinutes: null, reviewedById: null, reviewedAt: null, reviewNote: null }, { transaction });
    }
  }

  async list(auth: AuthContext, query: OvertimeQueryDto) {
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
    if (query.month) filters.push({ workDate: { [Op.like]: `${query.month}-%` } } as WhereOptions);
    const { rows, count } = await AttendanceOvertime.findAndCountAll({
      where: { [Op.and]: filters },
      include: [
        { model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
        { model: AttendanceRecord, attributes: ['id', 'checkInAt', 'checkOutAt', 'workedMinutes'] },
      ],
      order: [
        [literal(`CASE WHEN "AttendanceOvertime"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['workDate', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const [reviewers, runs] = await Promise.all([this.names(rows.map((r) => r.reviewedById)), this.runs(rows.map((r) => r.payrollRunId))]);
    return new PaginatedResult(
      rows.map((o) => this.present(o, reviewers, runs, self?.id ?? null)),
      paginationMeta(query, count),
    );
  }

  async approve(auth: AuthContext, id: string, dto: ReviewOvertimeDto) {
    await this.review(auth, id, async (o, employee, transaction) => {
      const minutes = dto.minutes ?? o.minutes;
      if (minutes > o.minutes) throw AppError.validation([{ field: 'minutes', message: `Can't be more than the ${o.minutes} minutes worked` }]);
      await o.update({ status: 'APPROVED', approvedMinutes: minutes, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await this.audit.record(
        { action: 'attendance.overtime_approved', entityType: 'AttendanceOvertime', entityId: o.id, summary: `${hours(minutes)} overtime of ${fullName(employee)} on ${o.workDate} approved` },
        transaction,
      );
      await this.tell(employee, `${hours(minutes)} overtime on ${o.workDate} approved`, 'It will be paid with the next payroll.', transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: ReviewOvertimeDto) {
    if (!dto.note || dto.note.trim().length < 3) throw AppError.validation([{ field: 'note', message: 'Give a reason' }]);
    await this.review(auth, id, async (o, employee, transaction) => {
      await o.update({ status: 'REJECTED', approvedMinutes: null, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record(
        { action: 'attendance.overtime_rejected', entityType: 'AttendanceOvertime', entityId: o.id, summary: `Overtime of ${fullName(employee)} on ${o.workDate} not approved` },
        transaction,
      );
      await this.tell(employee, `Overtime on ${o.workDate} was not approved`, dto.note ?? undefined, transaction);
    });
    return this.get(auth, id);
  }

  private async get(auth: AuthContext, id: string) {
    const o = (await AttendanceOvertime.findByPk(id, {
      include: [
        { model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] },
        { model: AttendanceRecord, attributes: ['id', 'checkInAt', 'checkOutAt', 'workedMinutes'] },
      ],
    }))!;
    const self = await this.scope.self(auth);
    return this.present(o, await this.names([o.reviewedById]), await this.runs([o.payrollRunId]), self?.id ?? null);
  }

  private async review(auth: AuthContext, id: string, fn: (o: AttendanceOvertime, employee: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const o = await AttendanceOvertime.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!o) throw AppError.notFound('Overtime');
      const employee = (await Employee.findByPk(o.employeeId, {
        attributes: ['id', 'organizationId', 'firstName', 'lastName', 'employeeCode', 'managerId', 'departmentId', 'membershipId'],
        transaction,
      }))!;
      if (!(await this.scope.covers(auth, 'attendance.regularize.approve', employee))) throw AppError.notFound('Overtime');
      if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own overtime");
      if (o.status !== 'PENDING') throw AppError.conflict(`This overtime is already ${o.status.toLowerCase()}`);
      await fn(o, employee, transaction);
    });
  }

  private async tell(employee: Employee, title: string, body: string | undefined, transaction: Transaction) {
    const userId = (await userIdsOf([employee.id], transaction)).get(employee.id);
    if (userId) await this.notifications.notify(userId, { organizationId: employee.organizationId, type: 'attendance.overtime', title, body, link: '/me/attendance' }, transaction);
  }

  private present(o: AttendanceOvertime, reviewers: Map<string, string>, runs: Map<string, string>, selfId: string | null) {
    return {
      id: o.id,
      workDate: o.workDate,
      minutes: o.minutes,
      approvedMinutes: o.approvedMinutes,
      status: o.status,
      reviewNote: o.reviewNote,
      reviewedBy: o.reviewedById ? (reviewers.get(o.reviewedById) ?? 'Former user') : null,
      reviewedAt: o.reviewedAt,
      paidIn: o.payrollRunId ? (runs.get(o.payrollRunId) ?? null) : null,
      employee: o.employee ? { id: o.employee.id, name: fullName(o.employee), employeeCode: o.employee.employeeCode } : null,
      record: o.record ? { checkInAt: o.record.checkInAt, checkOutAt: o.record.checkOutAt, workedMinutes: o.record.workedMinutes } : null,
      permissions: { review: o.status === 'PENDING' && o.employeeId !== selfId },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private async runs(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return new Map((await PayrollRun.findAll({ where: { id: unique }, attributes: ['id', 'year', 'month'] })).map((r) => [r.id, `${months[r.month - 1]} ${r.year}`]));
  }
}
