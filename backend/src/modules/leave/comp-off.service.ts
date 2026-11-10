import { Injectable } from '@nestjs/common';
import { literal, Op, UniqueConstraintError, type Transaction, type WhereOptions } from 'sequelize';
import { COMP_OFF_REQUEST_WINDOW_DAYS, type CompOffDayKind } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { fullName } from '../../common/utils/names';
import { addDays } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, CompOffRequest, Employee, LeaveLedgerEntry, LeaveType, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AttendanceRulesService, type EmployeeContext, type HolidayCalendar } from '../attendance/attendance-rules.service';
import { managerAndCover } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CompOffQueryDto, CreateCompOffDto, RejectLeaveDto, ReviewLeaveDto } from './dto/leave.dto';
import { LEAVE_EMPLOYEE_ATTRS, LeaveBalanceService } from './leave-balance.service';

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
const dayWord = (days: number) => (days === 1 ? '1 day' : `${days} day`);

/**
 * Compensatory off: someone who worked on a holiday or weekly off (by their location and shift) asks for the day back;
 * their manager — anyone with `leave.approve` in scope, never themselves — approves it, which credits the
 * organization's comp-off leave type. Each credit expires after the type's validity period (see LeaveBalanceService).
 */
@Injectable()
export class CompOffService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly balances: LeaveBalanceService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The active comp-off leave type, if the organization has one. */
  type() {
    return LeaveType.findOne({ where: { compOffValidityDays: { [Op.ne]: null }, isActive: true } });
  }

  /** Days off in the last few weeks that the signed-in employee worked, with what each can earn. */
  async eligible(auth: AuthContext) {
    const type = await this.type();
    const base = { enabled: !!type, leaveType: type ? { id: type.id, code: type.code, name: type.name, validityDays: type.compOffValidityDays! } : null, windowDays: COMP_OFF_REQUEST_WINDOW_DAYS };
    const employee = await this.selfEmployee(auth);
    if (!employee) return { ...base, days: [] };
    const today = this.rules.today((await this.rules.context(auth.organizationId!, employee)).timeZone);
    const windowStart = addDays(today, -COMP_OFF_REQUEST_WINDOW_DAYS);
    const from = windowStart < employee.dateOfJoining ? employee.dateOfJoining : windowStart;
    if (from > today) return { ...base, days: [] };
    const ctx = await this.rules.context(auth.organizationId!, employee, { from, to: today });
    const [records, holidays, requests] = await Promise.all([
      AttendanceRecord.findAll({
        where: { employeeId: employee.id, workDate: { [Op.between]: [from, today] }, workedMinutes: { [Op.gt]: 0 } },
        attributes: ['workDate', 'workedMinutes'],
        order: [['workDate', 'DESC']],
      }),
      this.rules.holidays(from, today),
      CompOffRequest.findAll({ where: { employeeId: employee.id, workDate: { [Op.between]: [from, today] }, status: ['PENDING', 'APPROVED'] }, attributes: ['id', 'workDate', 'status', 'days'] }),
    ]);
    const requestBy = new Map(requests.map((r) => [r.workDate, r]));
    const days = records.flatMap((r) => {
      const day = this.dayOff(ctx, holidays, r.workDate);
      const maxDays = this.earned(ctx, r.workDate, r.workedMinutes ?? 0);
      if (!day || !maxDays) return [];
      const request = requestBy.get(r.workDate);
      return [
        {
          date: r.workDate,
          kind: day.kind,
          label: day.label,
          workedMinutes: r.workedMinutes ?? 0,
          maxDays,
          request: request ? { id: request.id, status: request.status, days: Number(request.days) } : null,
        },
      ];
    });
    return { ...base, days };
  }

  async create(auth: AuthContext, dto: CreateCompOffDto) {
    const type = await this.type();
    if (!type) throw AppError.conflict("Comp-off isn't set up for your organization yet. Ask your HR team.");
    const employee = await this.selfEmployee(auth);
    if (!employee) throw AppError.notFound('Employee record linked to your account');
    if (employee.status === 'EXITED') throw AppError.forbidden('You have exited the organization');
    const ctx = await this.rules.context(auth.organizationId!, employee, { from: dto.workDate, to: dto.workDate });
    const today = this.rules.today(ctx.timeZone);
    if (dto.workDate > today) throw AppError.validation([{ field: 'workDate', message: 'Ask for comp-off after you have worked the day' }]);
    if (dto.workDate < addDays(today, -COMP_OFF_REQUEST_WINDOW_DAYS))
      throw AppError.validation([{ field: 'workDate', message: `Comp-off can be asked for up to ${COMP_OFF_REQUEST_WINDOW_DAYS} days after the day worked` }]);
    if (dto.workDate < employee.dateOfJoining) throw AppError.validation([{ field: 'workDate', message: 'This is before your date of joining' }]);
    const day = this.dayOff(ctx, await this.rules.holidays(dto.workDate, dto.workDate), dto.workDate);
    if (!day) throw AppError.validation([{ field: 'workDate', message: `${dto.workDate} was a working day for you, not a holiday or weekly off` }]);
    const record = await AttendanceRecord.findOne({ where: { employeeId: employee.id, workDate: dto.workDate }, attributes: ['workedMinutes'] });
    if (!record?.workedMinutes) throw AppError.validation([{ field: 'workDate', message: 'No completed attendance (punch in and out) on this day' }]);
    const maxDays = this.earned(ctx, dto.workDate, record.workedMinutes);
    if (!maxDays) throw AppError.validation([{ field: 'workDate', message: `You worked ${hours(record.workedMinutes)}, less than a half day` }]);
    if (dto.days > maxDays) throw AppError.validation([{ field: 'days', message: `You worked ${hours(record.workedMinutes)}: that earns half a day` }]);

    const id = await this.db
      .transaction(async (transaction) => {
        const r = await CompOffRequest.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            workDate: dto.workDate,
            dayKind: day.kind,
            dayLabel: day.label,
            workedMinutes: record.workedMinutes!,
            days: String(dto.days),
            reason: dto.reason,
            requestedById: auth.userId,
          },
          { transaction },
        );
        await this.audit.record(
          { action: 'leave.comp_off_requested', entityType: 'CompOffRequest', entityId: r.id, summary: `Comp-off of ${dayWord(dto.days)} requested for working on ${dto.workDate}` },
          transaction,
        );
        for (const managerUser of await managerAndCover(employee.managerId, transaction)) {
          if (managerUser === auth.userId) continue;
          await this.notifications.notify(
            managerUser,
            {
              organizationId: auth.organizationId,
              type: 'leave.comp_off',
              title: `${fullName(employee)} asked for comp-off for ${dto.workDate}${day.label ? ` (${day.label})` : ''}`,
              body: dto.reason,
              link: '/hr/leave/requests?tab=comp-off',
            },
            transaction,
          );
        }
        return r.id;
      })
      .catch((e: unknown) => {
        if (e instanceof UniqueConstraintError) throw AppError.conflict(`You already asked for comp-off for ${dto.workDate}`);
        throw e;
      });
    return this.get(auth, id);
  }

  async list(auth: AuthContext, query: CompOffQueryDto) {
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if ((query.view ?? 'mine') === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, 'leave.approve', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped);
      if (self) filters.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    const { rows, count } = await CompOffRequest.findAndCountAll({
      where: { [Op.and]: filters },
      include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }],
      order: [
        [literal(`CASE WHEN "CompOffRequest"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['workDate', 'DESC'],
      ],
      ...paginationArgs(query),
    });
    const reviewers = await this.names(rows.map((r) => r.reviewedById));
    return new PaginatedResult(
      rows.map((r) => this.present(r, reviewers, self?.id ?? null)),
      paginationMeta(query, count),
    );
  }

  async approve(auth: AuthContext, id: string, dto: ReviewLeaveDto) {
    const type = await this.type();
    if (!type) throw AppError.conflict('There is no active comp-off leave type to credit. Set one up under Leave types.');
    const year = await this.balances.yearContext(auth.organizationId!);
    await this.review(auth, id, async (r, employee, transaction) => {
      const expiresOn = addDays(r.workDate, type.compOffValidityDays!);
      if (expiresOn < year.today) throw AppError.conflict(`This comp-off would have expired on ${expiresOn}`);
      await r.update({ status: 'APPROVED', leaveTypeId: type.id, expiresOn, reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null }, { transaction });
      await LeaveLedgerEntry.create(
        {
          organizationId: auth.organizationId!,
          employeeId: r.employeeId,
          leaveTypeId: type.id,
          leaveYear: year.currentYear,
          kind: 'GRANT',
          days: r.days,
          effectiveDate: year.today,
          note: `Comp-off for working on ${r.workDate}${r.dayLabel ? ` (${r.dayLabel})` : ''}; use by ${expiresOn}`,
          idempotencyKey: `compoff:${r.id}`,
          createdById: auth.userId,
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'leave.comp_off_approved', entityType: 'CompOffRequest', entityId: id, summary: `Comp-off of ${dayWord(Number(r.days))} for ${fullName(employee)} (${r.workDate}) approved` },
        transaction,
      );
      await this.tell(r, `Comp-off for ${r.workDate} approved: ${dayWord(Number(r.days))} of ${type.name}`, `Use it by ${expiresOn}.${dto.note ? ` ${dto.note}` : ''}`, auth, transaction);
    });
    return this.get(auth, id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectLeaveDto) {
    await this.review(auth, id, async (r, employee, transaction) => {
      await r.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { transaction });
      await this.audit.record({ action: 'leave.comp_off_rejected', entityType: 'CompOffRequest', entityId: id, summary: `Comp-off for ${fullName(employee)} (${r.workDate}) rejected` }, transaction);
      await this.tell(r, `Comp-off for ${r.workDate} was not approved`, dto.note, auth, transaction);
    });
    return this.get(auth, id);
  }

  /** The employee withdraws a pending request. */
  async cancel(auth: AuthContext, id: string) {
    const self = await this.scope.self(auth);
    await this.db.transaction(async (transaction) => {
      const r = await CompOffRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r || !self || r.employeeId !== self.id) throw AppError.notFound('Request');
      if (r.status !== 'PENDING') throw AppError.conflict('Only pending requests can be withdrawn');
      await r.update({ status: 'CANCELLED' }, { transaction });
      await this.audit.record({ action: 'leave.comp_off_cancelled', entityType: 'CompOffRequest', entityId: id, summary: `Comp-off request for ${r.workDate} withdrawn` }, transaction);
    });
    return this.get(auth, id);
  }

  /** A non-optional holiday at the employee's location, else a weekly or rostered day off. */
  private dayOff(ctx: EmployeeContext, holidays: HolidayCalendar, date: string): { kind: CompOffDayKind; label: string | null } | null {
    const holiday = holidays.on(date, ctx.locationId);
    if (holiday && !holiday.isOptional) return { kind: 'HOLIDAY', label: holiday.name };
    if (this.rules.isRestDay(ctx, date)) return { kind: 'WEEKLY_OFF', label: null };
    return null;
  }

  /** A full day of the shift earns a day, half of it earns half. */
  private earned(ctx: EmployeeContext, date: string, workedMinutes: number): 0 | 0.5 | 1 {
    const shift = this.rules.shiftOn(ctx, date);
    return workedMinutes >= shift.fullDayMinutes ? 1 : workedMinutes >= shift.halfDayMinutes ? 0.5 : 0;
  }

  private async selfEmployee(auth: AuthContext) {
    const self = await this.scope.self(auth);
    return self ? Employee.findByPk(self.id, { attributes: LEAVE_EMPLOYEE_ATTRS }) : null;
  }

  private async get(auth: AuthContext, id: string) {
    const r = (await CompOffRequest.findByPk(id, { include: [{ model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode'] }] }))!;
    const self = await this.scope.self(auth);
    return this.present(r, await this.names([r.reviewedById]), self?.id ?? null);
  }

  private async review(auth: AuthContext, id: string, fn: (r: CompOffRequest, employee: Employee, transaction: Transaction) => Promise<void>) {
    await this.db.transaction(async (transaction) => {
      const r = await CompOffRequest.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!r) throw AppError.notFound('Request');
      const employee = (await Employee.findByPk(r.employeeId, {
        attributes: ['id', 'organizationId', 'firstName', 'lastName', 'employeeCode', 'managerId', 'departmentId', 'membershipId'],
        transaction,
      }))!;
      if (!(await this.scope.covers(auth, 'leave.approve', employee))) throw AppError.notFound('Request');
      if (auth.membershipId && employee.membershipId === auth.membershipId) throw AppError.forbidden("You can't review your own request");
      if (r.status !== 'PENDING') throw AppError.conflict(`This request is already ${r.status.toLowerCase()}`);
      await fn(r, employee, transaction);
    });
  }

  private async tell(r: CompOffRequest, title: string, body: string | undefined, auth: AuthContext, transaction: Transaction) {
    if (!r.requestedById || r.requestedById === auth.userId) return;
    await this.notifications.notify(r.requestedById, { organizationId: auth.organizationId, type: 'leave.comp_off', title, body, link: '/me/leave' }, transaction);
  }

  private present(r: CompOffRequest, reviewers: Map<string, string>, selfId: string | null) {
    return {
      id: r.id,
      workDate: r.workDate,
      dayKind: r.dayKind,
      dayLabel: r.dayLabel,
      workedMinutes: r.workedMinutes,
      days: Number(r.days),
      reason: r.reason,
      status: r.status,
      expiresOn: r.expiresOn,
      reviewNote: r.reviewNote,
      reviewedBy: r.reviewedById ? (reviewers.get(r.reviewedById) ?? 'Former user') : null,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode } : null,
      permissions: { review: r.status === 'PENDING' && r.employeeId !== selfId, cancel: r.employeeId === selfId && r.status === 'PENDING' },
    };
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    return new Map((await User.findAll({ where: { id: unique }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }
}
