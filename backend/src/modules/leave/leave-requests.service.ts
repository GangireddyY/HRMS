import { Injectable } from '@nestjs/common';
import { literal, Op, type Transaction, type WhereOptions } from 'sequelize';
import { APPROVAL_LEVEL_LABELS, LEAVE_MAX_SPAN_DAYS, type LeaveSession } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { addDays, monthRange } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendancePeriod, Department, Employee, Holiday, LeaveLedgerEntry, LeaveRequest, LeaveType, Location, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { AttendanceRulesService, holidayAppliesAt } from '../attendance/attendance-rules.service';
import { managerAndCover, usersWithPermission } from '../employees/employee-people';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { ApplyLeaveDto, CancelLeaveDto, LeaveCalendarQueryDto, LeaveQuoteDto, LeaveRequestQueryDto, RejectLeaveDto, ReviewLeaveDto } from './dto/leave.dto';
import { appliesTo, LEAVE_EMPLOYEE_ATTRS, LeaveBalanceService, type LeaveYearContext } from './leave-balance.service';
import { approvalLevelsFor } from './leave-types.service';
import { countLeaveDays, leaveYearOf, leaveYearRange, sessionsOverlap, type CountedDay } from './leave-policy';
import { fullName } from '../../common/utils/names';

const plural = (n: number, w = 'day') => `${n} ${w}${n === 1 ? '' : 's'}`;
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);

interface Issue {
  field: string;
  message: string;
}

export interface LeaveQuote {
  days: number;
  breakdown: CountedDay[];
  leaveYear: number;
  /** null for unlimited types. */
  available: number | null;
  remainingAfter: number | null;
  issues: Issue[];
}

const REQUEST_INCLUDE = [
  { model: Employee, attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'departmentId', 'managerId'], include: [{ model: Department, attributes: ['id', 'name'] }] },
  { model: LeaveType, attributes: ['id', 'code', 'name', 'color', 'isPaid'] },
];

/** Leave requests: apply, approve / reject, cancel, lists and the team calendar. */
@Injectable()
export class LeaveRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
    private readonly balances: LeaveBalanceService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Applying --------------------------------------------------------------------------------

  /** Days, balance impact and every rule the request would break (nothing is saved). */
  async quote(auth: AuthContext, dto: LeaveQuoteDto): Promise<LeaveQuote> {
    const employee = await this.self(auth);
    const type = await this.type(dto.leaveTypeId);
    const ctx = await this.balances.yearContext(auth.organizationId!);
    return this.evaluate(auth, employee, type, dto, ctx);
  }

  async apply(auth: AuthContext, dto: ApplyLeaveDto) {
    const employee = await this.self(auth);
    const type = await this.type(dto.leaveTypeId);
    const ctx = await this.balances.yearContext(auth.organizationId!);
    const first = await this.evaluate(auth, employee, type, dto, ctx);
    if (first.issues.length) throw AppError.validation(first.issues);

    const request = await this.db.transaction(async (transaction) => {
      await this.balances.lockEmployee(employee.id, transaction);
      // Re-check balance and overlaps under the lock (another request may have been submitted meanwhile).
      const again = await this.evaluate(auth, employee, type, dto, ctx, undefined, transaction);
      if (again.issues.length) throw AppError.validation(again.issues);
      const created = await LeaveRequest.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          leaveTypeId: type.id,
          leaveYear: again.leaveYear,
          startDate: dto.startDate,
          endDate: dto.endDate,
          startSession: dto.startSession ?? 'FULL',
          endSession: dto.startDate === dto.endDate ? (dto.startSession ?? 'FULL') : (dto.endSession ?? 'FULL'),
          days: String(again.days),
          reason: dto.reason,
          requestedById: auth.userId,
          approvalLevels: approvalLevelsFor(type, again.days),
        },
        { transaction },
      );
      await this.audit.record(
        { action: 'leave.requested', entityType: 'LeaveRequest', entityId: created.id, summary: `${type.code} ${this.range(created)} (${plural(again.days)}) requested by ${fullName(employee)}` },
        transaction,
      );
      return created;
    });

    for (const approver of await managerAndCover(employee.managerId)) {
      if (approver === auth.userId) continue;
      await this.notifications.notify(approver, {
        organizationId: auth.organizationId,
        type: 'leave.request',
        title: `${fullName(employee)} applied for ${type.name.toLowerCase()} (${plural(Number(request.days))})`,
        body: `${this.range(request)}: ${dto.reason}`,
        link: '/hr/leave/requests',
      });
    }
    return this.get(request.id);
  }

  // ---- Reviewing -------------------------------------------------------------------------------

  async approve(auth: AuthContext, id: string, dto: ReviewLeaveDto) {
    const { request, employee, type } = await this.forReview(auth, id);
    await this.assertMonthsOpen(request.startDate, request.endDate);
    await this.balances.ensure(auth.organizationId!, [employee], request.leaveYear);
    const step = { level: request.approvalLevel, userId: auth.userId, name: (await this.actorName(auth.userId)) ?? 'Approver', at: new Date().toISOString(), note: dto.note ?? null };
    const final = request.approvalLevel >= request.approvalLevels;
    await this.db.transaction(async (transaction) => {
      await this.balances.lockEmployee(employee.id, transaction);
      const fresh = await LeaveRequest.findByPk(id, { transaction });
      if (fresh!.status !== 'PENDING' || fresh!.approvalLevel !== request.approvalLevel) throw AppError.conflict('This request changed meanwhile; refresh and try again');
      if (!type.unlimited && !type.allowNegativeBalance) {
        const available = await this.balances.available(employee, type, request.leaveYear, request.id, transaction);
        if (available < Number(request.days)) {
          throw AppError.conflict(`${fullName(employee)} has only ${plural(available)} of ${type.name.toLowerCase()} left, so ${plural(Number(request.days))} cannot be approved.`);
        }
      }
      const trail = [...(fresh!.approvalTrail ?? []), step];
      if (!final) {
        await fresh!.update({ approvalLevel: request.approvalLevel + 1, approvalTrail: trail }, { transaction });
        await this.audit.record(
          {
            action: 'leave.approved_level',
            entityType: 'LeaveRequest',
            entityId: id,
            summary: `${type.code} ${this.range(request)} for ${fullName(employee)} approved at level ${step.level}; waiting for ${APPROVAL_LEVEL_LABELS[step.level + 1]}`,
          },
          transaction,
        );
        return;
      }
      await LeaveLedgerEntry.create(
        {
          organizationId: auth.organizationId!,
          employeeId: employee.id,
          leaveTypeId: type.id,
          leaveYear: request.leaveYear,
          kind: 'TAKEN',
          days: String(-Number(request.days)),
          effectiveDate: request.startDate,
          leaveRequestId: request.id,
          note: `Leave ${this.range(request)}`,
          createdById: auth.userId,
        },
        { transaction },
      );
      await fresh!.update({ status: 'APPROVED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note ?? null, approvalTrail: trail }, { transaction });
      await this.audit.record({ action: 'leave.approved', entityType: 'LeaveRequest', entityId: id, summary: `${type.code} ${this.range(request)} for ${fullName(employee)} approved` }, transaction);
    });
    if (final) {
      await this.notifyEmployee(auth, request, `Your ${type.name.toLowerCase()} for ${this.range(request)} was approved`, dto.note);
      return this.get(id);
    }
    const next = APPROVAL_LEVEL_LABELS[step.level + 1]!;
    await this.notifyEmployee(auth, request, `Your ${type.name.toLowerCase()} for ${this.range(request)} was approved by ${step.name}; ${next} approves next`, dto.note);
    // The next level: people who approve leave department- or organization-wide (not the one who just approved).
    for (const userId of await usersWithPermission('leave.approve', undefined, ['DEPARTMENT', 'ORGANIZATION'])) {
      if (userId === auth.userId || userId === request.requestedById) continue;
      await this.notifications.notify(userId, {
        organizationId: auth.organizationId,
        type: 'leave.request',
        title: `${fullName(employee)}'s ${type.name.toLowerCase()} (${plural(Number(request.days))}) needs ${next} approval`,
        body: `${this.range(request)}. Approved by ${step.name}.`,
        link: '/hr/leave/requests',
      });
    }
    return this.get(id);
  }

  async reject(auth: AuthContext, id: string, dto: RejectLeaveDto) {
    const { request, employee, type } = await this.forReview(auth, id, 'reject');
    await this.db.transaction(async (transaction) => {
      const [count] = await LeaveRequest.update({ status: 'REJECTED', reviewedById: auth.userId, reviewedAt: new Date(), reviewNote: dto.note }, { where: { id, status: 'PENDING' }, transaction });
      if (!count) throw AppError.conflict('This request is no longer pending');
      await this.audit.record({ action: 'leave.rejected', entityType: 'LeaveRequest', entityId: id, summary: `${type.code} ${this.range(request)} for ${fullName(employee)} rejected` }, transaction);
    });
    await this.notifyEmployee(auth, request, `Your ${type.name.toLowerCase()} for ${this.range(request)} was rejected`, dto.note);
    return this.get(id);
  }

  /**
   * The employee cancels a pending request, or an approved one that has not started; an approver (leave.approve in scope)
   * cancels any approved leave. Cancelling approved leave returns the days to the balance.
   */
  async cancel(auth: AuthContext, id: string, dto: CancelLeaveDto) {
    const request = await LeaveRequest.findByPk(id, { include: [{ model: LeaveType }] });
    if (!request) throw AppError.notFound('Leave request');
    const employee = await Employee.findByPk(request.employeeId, { attributes: LEAVE_EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'leave.view', employee))) throw AppError.notFound('Leave request');
    const self = await this.scope.self(auth);
    const isOwn = self?.id === employee.id;
    const canApprove = !isOwn && (await this.scope.covers(auth, 'leave.approve', employee));
    if (!isOwn && !canApprove) throw AppError.forbidden();
    if (request.status !== 'PENDING' && request.status !== 'APPROVED') throw AppError.conflict(`This request is already ${request.status.toLowerCase()}`);
    const ctx = await this.balances.yearContext(auth.organizationId!);
    if (isOwn && request.status === 'APPROVED' && request.startDate <= ctx.today) {
      throw AppError.conflict('Approved leave that has started can only be cancelled by your manager or HR.');
    }
    if (!isOwn && request.status === 'APPROVED' && !dto.reason) throw AppError.validation([{ field: 'reason', message: 'Give a reason; the employee is notified' }]);
    if (request.status === 'APPROVED') await this.assertMonthsOpen(request.startDate, request.endDate);
    const wasApproved = request.status === 'APPROVED';
    const type = request.leaveType!;

    await this.db.transaction(async (transaction) => {
      await this.balances.lockEmployee(employee.id, transaction);
      const [count] = await LeaveRequest.update(
        { status: 'CANCELLED', cancelledById: auth.userId, cancelledAt: new Date(), cancelReason: dto.reason ?? null },
        { where: { id, status: request.status }, transaction },
      );
      if (!count) throw AppError.conflict('This request changed meanwhile; refresh and try again');
      if (wasApproved) {
        await LeaveLedgerEntry.create(
          {
            organizationId: auth.organizationId!,
            employeeId: employee.id,
            leaveTypeId: type.id,
            leaveYear: request.leaveYear,
            kind: 'REVERSAL',
            days: request.days,
            effectiveDate: ctx.today < request.startDate ? ctx.today : request.startDate,
            leaveRequestId: request.id,
            note: `Cancelled leave ${this.range(request)}`,
            createdById: auth.userId,
          },
          { transaction },
        );
      }
      await this.audit.record(
        {
          action: 'leave.cancelled',
          entityType: 'LeaveRequest',
          entityId: id,
          summary: `${type.code} ${this.range(request)} for ${fullName(employee)} cancelled${wasApproved ? ' (days returned)' : ''}`,
        },
        transaction,
      );
    });

    if (!isOwn) await this.notifyEmployee(auth, request, `Your ${type.name.toLowerCase()} for ${this.range(request)} was cancelled`, dto.reason);
    else if (wasApproved) {
      const manager = await this.managerUserId(employee);
      if (manager) {
        await this.notifications.notify(manager, {
          organizationId: auth.organizationId,
          type: 'leave.request',
          title: `${fullName(employee)} cancelled approved ${type.name.toLowerCase()} (${this.range(request)})`,
          body: dto.reason ?? undefined,
          link: '/hr/leave/requests',
        });
      }
    }
    return this.get(id);
  }

  // ---- Lists & calendar ------------------------------------------------------------------------

  async list(auth: AuthContext, query: LeaveRequestQueryDto) {
    const view = query.view ?? 'mine';
    const self = await this.scope.self(auth);
    const filters: WhereOptions[] = [];
    if (view === 'mine') {
      if (!self) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push({ employeeId: self.id });
    } else {
      const scoped = await this.scope.where(auth, view === 'team' ? 'leave.approve' : 'leave.view', 'employeeId');
      if (!scoped) return new PaginatedResult([], paginationMeta(query, 0));
      filters.push(scoped);
      // Approvers never act on their own requests.
      if (view === 'team' && self) filters.push({ employeeId: { [Op.ne]: self.id } });
    }
    if (query.status) filters.push({ status: query.status });
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) filters.push({ leaveTypeId: query.leaveTypeId });
    if (query.from) filters.push({ endDate: { [Op.gte]: query.from } });
    if (query.to) filters.push({ startDate: { [Op.lte]: query.to } });
    const { rows, count } = await LeaveRequest.findAndCountAll({
      where: { [Op.and]: filters },
      include: REQUEST_INCLUDE,
      order: [
        [literal(`CASE WHEN "LeaveRequest"."status" = 'PENDING' THEN 0 ELSE 1 END`), 'ASC'],
        ['startDate', view === 'mine' ? 'DESC' : 'ASC'],
        ['createdAt', 'DESC'],
      ],
      distinct: true,
      ...paginationArgs(query),
    });
    const names = await this.actorNames(rows);
    const reviewable = new Map<string, boolean>();
    if (view === 'team') {
      for (const r of rows) if (r.status === 'PENDING' && r.employee) reviewable.set(r.id, !(await this.levelBlock(auth, r, r.employee)));
    }
    return new PaginatedResult(
      rows.map((r) => ({ ...this.present(r, names, self?.id), canApprove: reviewable.get(r.id) ?? false, onBehalfOf: r.employee ? this.scope.delegatedBy(auth, 'leave.approve', r.employee) : null })),
      paginationMeta(query, count),
    );
  }

  /** Approved and pending leave in a month, within leave.view scope, with holidays. */
  async calendar(auth: AuthContext, query: LeaveCalendarQueryDto) {
    const [year, month] = query.month.split('-').map(Number) as [number, number];
    const { from, to, days } = monthRange(year, month);
    const holidays = await Holiday.findAll({ where: { date: { [Op.between]: [from, to] } }, order: [['date', 'ASC']] });
    const locationIds = [...new Set(holidays.flatMap((h) => h.locationIds ?? []))];
    const locationNames = new Map(locationIds.length ? (await Location.findAll({ where: { id: locationIds }, attributes: ['id', 'name'] })).map((l) => [l.id, l.name]) : []);
    const scoped = await this.scope.where(auth, 'leave.view', 'employeeId');
    const base = {
      month: query.month,
      days,
      holidays: holidays.map((h) => ({ date: h.date, name: h.name, isOptional: h.isOptional, locations: (h.locationIds ?? []).map((id) => locationNames.get(id)).filter((n): n is string => !!n) })),
    };
    if (!scoped) return { ...base, entries: [] };
    const rows = await LeaveRequest.findAll({
      where: { [Op.and]: [scoped, { status: ['PENDING', 'APPROVED'] }, { startDate: { [Op.lte]: to } }, { endDate: { [Op.gte]: from } }] },
      include: [
        {
          model: Employee,
          attributes: ['id', 'firstName', 'lastName', 'employeeCode', 'departmentId'],
          include: [{ model: Department, attributes: ['id', 'name'] }],
          ...(query.departmentId ? { where: { departmentId: query.departmentId } } : {}),
        },
        { model: LeaveType, attributes: ['id', 'code', 'name', 'color', 'isPaid'] },
      ],
      order: [['startDate', 'ASC']],
      limit: 2000,
    });
    return {
      ...base,
      entries: rows.map((r) => ({
        id: r.id,
        employee: { id: r.employee!.id, name: fullName(r.employee!), employeeCode: r.employee!.employeeCode, department: r.employee!.department?.name ?? null },
        leaveType: { id: r.leaveType!.id, code: r.leaveType!.code, name: r.leaveType!.name, color: r.leaveType!.color },
        startDate: r.startDate,
        endDate: r.endDate,
        startSession: r.startSession,
        endSession: r.endSession,
        days: Number(r.days),
        status: r.status,
      })),
    };
  }

  // ---- Rules -----------------------------------------------------------------------------------

  private async evaluate(auth: AuthContext, employee: Employee, type: LeaveType, dto: LeaveQuoteDto, ctx: LeaveYearContext, excludeRequestId?: string, transaction?: Transaction): Promise<LeaveQuote> {
    const issues: Issue[] = [];
    const startSession: LeaveSession = dto.startSession ?? 'FULL';
    const endSession: LeaveSession = dto.startDate === dto.endDate ? startSession : (dto.endSession ?? 'FULL');
    const leaveYear = leaveYearOf(dto.startDate, ctx.startMonth);
    const empty: LeaveQuote = { days: 0, breakdown: [], leaveYear, available: null, remainingAfter: null, issues };

    if (dto.endDate < dto.startDate) return { ...empty, issues: [{ field: 'endDate', message: 'The end date is before the start date' }] };
    if (daysBetween(dto.startDate, dto.endDate) >= LEAVE_MAX_SPAN_DAYS)
      return { ...empty, issues: [{ field: 'endDate', message: 'A request can cover at most a year; split it into several requests' }] };
    if (!type.isActive) issues.push({ field: 'leaveTypeId', message: `${type.name} is no longer available` });
    if (!appliesTo(type, employee)) issues.push({ field: 'leaveTypeId', message: `${type.name} does not apply to you` });
    if (!type.allowHalfDay && (startSession !== 'FULL' || endSession !== 'FULL')) issues.push({ field: 'startSession', message: `${type.name} cannot be taken in half days` });
    if (dto.startDate !== dto.endDate && (startSession === 'FIRST_HALF' || endSession === 'SECOND_HALF')) {
      issues.push({ field: 'startSession', message: 'A multi-day leave can start in the afternoon and end at noon only' });
    }
    if (leaveYearOf(dto.endDate, ctx.startMonth) !== leaveYear) {
      const r = leaveYearRange(leaveYear, ctx.startMonth);
      issues.push({ field: 'endDate', message: `The leave year ends on ${r.to}. Apply separately for the days after it.` });
    }
    if (leaveYear < ctx.currentYear) issues.push({ field: 'startDate', message: 'This date is in a previous leave year. Ask HR to record it.' });
    if (leaveYear > ctx.currentYear && !type.unlimited) issues.push({ field: 'startDate', message: `${type.name} for the next leave year can be requested once that year's balance is credited` });

    // Employment and timing.
    if (employee.status === 'EXITED') issues.push({ field: 'startDate', message: 'Exited employees cannot apply for leave' });
    if (dto.startDate < employee.dateOfJoining) issues.push({ field: 'startDate', message: 'The start date is before your date of joining' });
    if (employee.exitDate && dto.endDate > employee.exitDate) issues.push({ field: 'endDate', message: `Your last working day is ${employee.exitDate}` });
    const eligibleFrom = addDays(employee.dateOfJoining, type.eligibleAfterDays);
    if (type.eligibleAfterDays && dto.startDate < eligibleFrom)
      issues.push({ field: 'leaveTypeId', message: `${type.name} can be used from ${eligibleFrom} (${type.eligibleAfterDays} days after joining)` });
    if (dto.startDate >= ctx.today) {
      const notice = daysBetween(ctx.today, dto.startDate);
      if (notice < type.minNoticeDays) issues.push({ field: 'startDate', message: `${type.name} needs ${plural(type.minNoticeDays)}' notice (earliest ${addDays(ctx.today, type.minNoticeDays)})` });
    } else {
      const back = daysBetween(dto.startDate, ctx.today);
      if (back > type.maxBackdatedDays) {
        issues.push({
          field: 'startDate',
          message: type.maxBackdatedDays ? `${type.name} can be applied for up to ${plural(type.maxBackdatedDays)} after the fact` : `${type.name} cannot be applied for past dates`,
        });
      }
    }

    // Days.
    const empCtx = await this.rules.context(auth.organizationId!, employee, { from: dto.startDate, to: dto.endDate });
    const holidayRows = (await Holiday.findAll({ where: { date: { [Op.between]: [dto.startDate, dto.endDate] }, isOptional: false }, attributes: ['date', 'locationIds'], transaction })).filter((h) =>
      holidayAppliesAt(h, employee.locationId),
    );
    const restDays = new Set<string>();
    for (let d = dto.startDate; d <= dto.endDate; d = addDays(d, 1)) if (this.rules.isRestDay(empCtx, d)) restDays.add(d);
    const { days, breakdown } = countLeaveDays(dto.startDate, dto.endDate, startSession, endSession, {
      weeklyOffs: empCtx.shift.weeklyOffs,
      restDays,
      holidays: new Set(holidayRows.map((h) => h.date)),
      countNonWorkingDays: type.countNonWorkingDays,
    });
    if (days <= 0) issues.push({ field: 'startDate', message: 'The selected dates are all weekly offs or holidays' });
    if (type.maxConsecutiveDays && days > type.maxConsecutiveDays) issues.push({ field: 'endDate', message: `${type.name} can be taken for at most ${plural(type.maxConsecutiveDays)} at a time` });

    // Overlaps with other pending or approved leave.
    const others = await LeaveRequest.findAll({
      where: {
        employeeId: employee.id,
        status: ['PENDING', 'APPROVED'],
        startDate: { [Op.lte]: dto.endDate },
        endDate: { [Op.gte]: dto.startDate },
        ...(excludeRequestId ? { id: { [Op.ne]: excludeRequestId } } : {}),
      },
      include: [{ model: LeaveType, attributes: ['code'] }],
      transaction,
    });
    const clash = others.find((o) => sessionsOverlap(o, { startDate: dto.startDate, endDate: dto.endDate, startSession, endSession }));
    if (clash)
      issues.push({ field: 'startDate', message: `You already have ${clash.status === 'PENDING' ? 'a pending' : 'approved'} ${clash.leaveType?.code ?? ''} request for ${this.range(clash)}` });

    // Closed attendance months (payroll inputs are locked).
    const closed = await this.closedMonths(dto.startDate, dto.endDate);
    if (closed.length) issues.push({ field: 'startDate', message: `Attendance for ${closed.join(', ')} is closed. Ask HR to reopen it first.` });

    // Balance.
    let available: number | null = null;
    if (!type.unlimited && leaveYear <= ctx.currentYear) {
      if (!transaction) await this.balances.ensure(auth.organizationId!, [employee], leaveYear);
      available = await this.balances.available(employee, type, leaveYear, excludeRequestId, transaction);
      if (days > available && !type.allowNegativeBalance) {
        issues.push({ field: 'endDate', message: `Not enough ${type.name.toLowerCase()}: ${plural(available)} available, ${plural(days)} requested` });
      }
    }
    return { days, breakdown, leaveYear, available, remainingAfter: available === null ? null : Math.round((available - days) * 100) / 100, issues };
  }

  private async closedMonths(from: string, to: string): Promise<string[]> {
    const months: { year: number; month: number }[] = [];
    for (let d = `${from.slice(0, 7)}-01`; d <= to; d = addDays(monthRange(Number(d.slice(0, 4)), Number(d.slice(5, 7))).to, 1))
      months.push({ year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) });
    const rows = await AttendancePeriod.findAll({ where: { [Op.or]: months }, attributes: ['year', 'month'] });
    return rows.map((r) => `${r.year}-${String(r.month).padStart(2, '0')}`);
  }

  private async assertMonthsOpen(from: string, to: string) {
    const closed = await this.closedMonths(from, to);
    if (closed.length) throw AppError.conflict(`Attendance for ${closed.join(', ')} is closed. Reopen the month before changing this leave.`);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async self(auth: AuthContext): Promise<Employee> {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    return (await Employee.findByPk(self.id, { attributes: LEAVE_EMPLOYEE_ATTRS }))!;
  }

  private async type(id: string): Promise<LeaveType> {
    const type = await LeaveType.findByPk(id);
    if (!type) throw AppError.validation([{ field: 'leaveTypeId', message: 'Leave type not found' }]);
    return type;
  }

  /** Any approver in scope can reject; approving also has to fit the request's current level. */
  private async forReview(auth: AuthContext, id: string, action: 'approve' | 'reject' = 'approve') {
    const request = await LeaveRequest.findByPk(id, { include: [{ model: LeaveType }] });
    if (!request) throw AppError.notFound('Leave request');
    const employee = await Employee.findByPk(request.employeeId, { attributes: LEAVE_EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'leave.approve', employee))) throw AppError.notFound('Leave request');
    const self = await this.scope.self(auth);
    if (self?.id === employee.id) throw AppError.forbidden('You cannot review your own leave');
    if (request.status !== 'PENDING') throw AppError.conflict(`This request is already ${request.status.toLowerCase()}`);
    const blocked = action === 'approve' ? await this.levelBlock(auth, request, employee) : null;
    if (blocked) throw AppError.forbidden(blocked);
    return { request, employee, type: request.leaveType! };
  }

  /**
   * Why the caller can't decide at the request's current level (null = they can): after the first level, someone with
   * department- or organization-wide reach who hasn't approved it already.
   */
  private async levelBlock(auth: AuthContext, request: LeaveRequest, employee: Pick<Employee, 'id' | 'managerId' | 'departmentId'>): Promise<string | null> {
    if (request.approvalLevel <= 1) return null;
    const label = APPROVAL_LEVEL_LABELS[request.approvalLevel] ?? 'the next level';
    if ((request.approvalTrail ?? []).some((s) => s.userId === auth.userId)) return `You approved the earlier level; ${label} has to approve this one`;
    if (!(await this.scope.coversBroadly(auth, 'leave.approve', employee))) return `This request is waiting for ${label} approval`;
    return null;
  }

  private async actorName(userId: string): Promise<string | null> {
    const u = await User.findByPk(userId, { attributes: ['firstName', 'lastName'] });
    return u ? fullName(u) : null;
  }

  private async get(id: string) {
    const r = await LeaveRequest.findByPk(id, { include: REQUEST_INCLUDE });
    return this.present(r!, await this.actorNames([r!]));
  }

  private present(r: LeaveRequest, names: Map<string, string>, selfId?: string) {
    return {
      id: r.id,
      employee: r.employee ? { id: r.employee.id, name: fullName(r.employee), employeeCode: r.employee.employeeCode, department: r.employee.department?.name ?? null } : null,
      leaveType: r.leaveType ? { id: r.leaveType.id, code: r.leaveType.code, name: r.leaveType.name, color: r.leaveType.color, isPaid: r.leaveType.isPaid } : null,
      leaveYear: r.leaveYear,
      startDate: r.startDate,
      endDate: r.endDate,
      startSession: r.startSession,
      endSession: r.endSession,
      days: Number(r.days),
      reason: r.reason,
      status: r.status,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedById ? (names.get(r.reviewedById) ?? null) : null,
      cancelledAt: r.cancelledAt,
      cancelledBy: r.cancelledById ? (names.get(r.cancelledById) ?? null) : null,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt,
      isOwn: selfId ? r.employeeId === selfId : undefined,
      approval: {
        level: r.approvalLevel,
        levels: r.approvalLevels,
        awaiting: r.status === 'PENDING' ? (APPROVAL_LEVEL_LABELS[r.approvalLevel] ?? null) : null,
        trail: (r.approvalTrail ?? []).map((s) => ({ level: s.level, name: s.name, at: s.at, note: s.note })),
      },
    };
  }

  private async actorNames(rows: LeaveRequest[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => [r.reviewedById, r.cancelledById]).filter((x): x is string => !!x))];
    if (!ids.length) return new Map();
    return new Map((await User.findAll({ where: { id: ids }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
  }

  private range(r: Pick<LeaveRequest, 'startDate' | 'endDate' | 'startSession' | 'endSession'>): string {
    const half = (s: LeaveSession) => (s === 'FIRST_HALF' ? ' (morning)' : s === 'SECOND_HALF' ? ' (afternoon)' : '');
    if (r.startDate === r.endDate) return `${r.startDate}${half(r.startSession)}`;
    return `${r.startDate}${r.startSession === 'SECOND_HALF' ? ' (afternoon)' : ''} – ${r.endDate}${r.endSession === 'FIRST_HALF' ? ' (morning)' : ''}`;
  }

  private async managerUserId(employee: Employee): Promise<string | null> {
    if (!employee.managerId) return null;
    const manager = await Employee.findByPk(employee.managerId, { attributes: ['membershipId'] });
    return this.balances.userIdOf(manager?.membershipId);
  }

  private async notifyEmployee(auth: AuthContext, request: LeaveRequest, title: string, body?: string | null) {
    const userId = request.requestedById;
    if (!userId || userId === auth.userId) return;
    await this.notifications.notify(userId, { organizationId: auth.organizationId, type: 'leave.request', title, body: body ?? undefined, link: '/me/leave' });
  }
}
