import { Injectable } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import type { DayStatus } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { containsPattern } from '../../common/utils/like';
import { minutesToTime, monthRange, weekday } from '../../common/utils/zoned-time';
import { DatabaseService } from '../../database/database.service';
import { AttendanceRecord, AttendanceRegularization, Department, Designation, Employee } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { EmployeeScopeService } from '../employees/employee-scope.service';
import { AttendanceRulesService, OPEN_PUNCH_HOURS, type EmployeeContext } from './attendance-rules.service';
import type { CalendarQueryDto, DailyQueryDto, PunchDto, UpsertRecordDto } from './dto/attendance.dto';

const EMPLOYEE_ATTRS = ['id', 'organizationId', 'employeeCode', 'firstName', 'lastName', 'status', 'dateOfJoining', 'exitDate', 'shiftId', 'locationId', 'managerId', 'departmentId', 'membershipId'];

export function presentRecord(r: AttendanceRecord | undefined | null) {
  if (!r) return null;
  return {
    id: r.id,
    workDate: r.workDate,
    checkInAt: r.checkInAt,
    checkOutAt: r.checkOutAt,
    workedMinutes: r.workedMinutes,
    lateMinutes: r.lateMinutes,
    status: r.status,
    source: r.source,
    note: r.note,
  };
}

function shiftSummary(ctx: EmployeeContext) {
  return {
    name: ctx.shift.name,
    startTime: minutesToTime(ctx.shift.startMinutes),
    endTime: minutesToTime(ctx.shift.endMinutes),
    crossesMidnight: ctx.shift.crossesMidnight,
    graceMinutes: ctx.shift.graceMinutes,
    fullDayMinutes: ctx.shift.fullDayMinutes,
    halfDayMinutes: ctx.shift.halfDayMinutes,
    weeklyOffs: ctx.shift.weeklyOffs,
  };
}

const fullName = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly scope: EmployeeScopeService,
    private readonly rules: AttendanceRulesService,
  ) {}

  // ---- Self-service ----------------------------------------------------------------------------

  async today(auth: AuthContext) {
    const self = await this.scope.self(auth);
    if (!self) return { employee: null };
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const date = this.rules.today(ctx.timeZone, now);
    const [record, open, holidays, closed] = await Promise.all([
      AttendanceRecord.findOne({ where: { employeeId: self.id, workDate: date } }),
      this.findOpen(self.id, now),
      this.rules.holidays(date, date),
      this.rules.isClosed(date),
    ]);
    const holiday = holidays.get(date);
    return {
      employee: { id: self.id, name: fullName(self), employeeCode: self.employeeCode, status: self.status },
      date,
      timeZone: ctx.timeZone,
      shift: shiftSummary(ctx),
      holiday: holiday ? { name: holiday.name, isOptional: holiday.isOptional } : null,
      isWeeklyOff: ctx.shift.weeklyOffs.includes(weekday(date)),
      record: presentRecord(record),
      openRecord: presentRecord(open),
      periodClosed: closed,
      serverTime: now,
    };
  }

  async punchIn(auth: AuthContext, dto: PunchDto, ip: string | undefined) {
    const self = await this.requireSelf(auth);
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const date = this.rules.today(ctx.timeZone, now);
    const open = await this.findOpen(self.id, now);
    if (open) throw AppError.conflict(`You are already punched in since ${this.localTime(open.checkInAt!, ctx)}. Punch out first.`);
    await this.rules.assertOpen(date);
    const existing = await AttendanceRecord.findOne({ where: { employeeId: self.id, workDate: date } });
    if (existing?.checkInAt) throw AppError.conflict(`You already recorded attendance today (in at ${this.localTime(existing.checkInAt, ctx)}). Ask for a regularization if it is wrong.`);
    await AttendanceRecord.create({
      organizationId: auth.organizationId!,
      employeeId: self.id,
      workDate: date,
      shiftId: ctx.shift.id,
      checkInAt: now,
      lateMinutes: this.rules.lateMinutes(now, date, ctx),
      source: 'WEB',
      checkInIp: ip ?? null,
      checkInLatitude: dto.latitude === undefined ? null : String(dto.latitude),
      checkInLongitude: dto.longitude === undefined ? null : String(dto.longitude),
      updatedById: auth.userId,
    });
    return this.today(auth);
  }

  async punchOut(auth: AuthContext, ip: string | undefined) {
    const self = await this.requireSelf(auth);
    const ctx = await this.rules.context(auth.organizationId!, self);
    const now = new Date();
    const open = await this.findOpen(self.id, now);
    if (!open) throw AppError.conflict("You haven't punched in yet.");
    await this.rules.assertOpen(open.workDate);
    await open.update({ checkOutAt: now, checkOutIp: ip ?? null, ...this.rules.outcome(open.checkInAt!, now, ctx.shift), updatedById: auth.userId });
    return this.today(auth);
  }

  // ---- Calendars & registers -------------------------------------------------------------------

  async calendar(auth: AuthContext, query: CalendarQueryDto) {
    const employee = await this.resolveEmployee(auth, query.employeeId);
    const ctx = await this.rules.context(auth.organizationId!, employee);
    const [year, month] = query.month.split('-').map(Number) as [number, number];
    const { from, to, days } = monthRange(year, month);
    const today = this.rules.today(ctx.timeZone);
    const [records, holidays, pending, closed] = await Promise.all([
      AttendanceRecord.findAll({ where: { employeeId: employee.id, workDate: { [Op.between]: [from, to] } } }),
      this.rules.holidays(from, to),
      AttendanceRegularization.findAll({ where: { employeeId: employee.id, status: 'PENDING', workDate: { [Op.between]: [from, to] } }, attributes: ['id', 'workDate'] }),
      this.rules.isClosed(from),
    ]);
    const byDate = new Map(records.map((r) => [r.workDate, r]));
    const pendingDates = new Map(pending.map((p) => [p.workDate, p.id]));
    const result = days.map((date) => {
      const holiday = holidays.get(date);
      const record = byDate.get(date);
      return {
        date,
        status: this.rules.dayStatus(date, today, employee, ctx, holiday, record),
        holiday: holiday ? { name: holiday.name, isOptional: holiday.isOptional } : null,
        record: presentRecord(record),
        pendingRegularizationId: pendingDates.get(date) ?? null,
      };
    });
    const count = (s: DayStatus) => result.filter((d) => d.status === s).length;
    return {
      employee: { id: employee.id, name: fullName(employee), employeeCode: employee.employeeCode },
      month: query.month,
      timeZone: ctx.timeZone,
      shift: shiftSummary(ctx),
      closed,
      today,
      days: result,
      summary: {
        present: count('PRESENT'),
        halfDay: count('HALF_DAY'),
        absent: count('ABSENT'),
        missedPunch: count('MISSED_PUNCH'),
        holidays: count('HOLIDAY'),
        weeklyOffs: count('WEEKLY_OFF'),
        lateDays: records.filter((r) => r.lateMinutes > 0).length,
        workedMinutes: records.reduce((n, r) => n + (r.workedMinutes ?? 0), 0),
      },
    };
  }

  async daily(auth: AuthContext, query: DailyQueryDto) {
    const scoped = await this.scope.where(auth, 'attendance.view');
    const date = query.date ?? this.rules.today(await this.rules.organizationTimeZone(auth.organizationId!));
    const emptySummary = { total: 0, present: 0, halfDay: 0, absent: 0, inProgress: 0, missedPunch: 0, late: 0, off: 0 };
    if (!scoped) return { date, summary: emptySummary, page: new PaginatedResult([], paginationMeta(query, 0)) };

    const filters: WhereOptions[] = [scoped, { dateOfJoining: { [Op.lte]: date } }, { [Op.or]: [{ exitDate: null }, { exitDate: { [Op.gte]: date } }] }];
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.search) {
      const p = containsPattern(query.search);
      filters.push({ [Op.or]: [{ firstName: { [Op.iLike]: p } }, { lastName: { [Op.iLike]: p } }, { employeeCode: { [Op.iLike]: p } }] });
    }
    const employees = await Employee.findAll({
      where: { [Op.and]: filters },
      attributes: EMPLOYEE_ATTRS,
      include: [{ model: Department, attributes: ['id', 'name'] }, { model: Designation, attributes: ['id', 'name'] }],
      order: [['firstName', 'ASC'], ['lastName', 'ASC']],
      limit: 5000,
    });
    const [contexts, records, holidays] = await Promise.all([
      this.rules.contexts(auth.organizationId!, employees),
      employees.length ? AttendanceRecord.findAll({ where: { workDate: date, employeeId: employees.map((e) => e.id) } }) : [],
      this.rules.holidays(date, date),
    ]);
    const byEmployee = new Map(records.map((r) => [r.employeeId, r]));
    const rows = employees.map((e) => {
      const ctx = contexts.get(e.id)!;
      const record = byEmployee.get(e.id);
      const status = this.rules.dayStatus(date, this.rules.today(ctx.timeZone), e, ctx, holidays.get(date), record);
      return {
        employee: { id: e.id, name: fullName(e), employeeCode: e.employeeCode, department: e.department ? { id: e.department.id, name: e.department.name } : null, designation: e.designation?.name ?? null },
        status,
        record: presentRecord(record),
        shift: { name: ctx.shift.name, startTime: minutesToTime(ctx.shift.startMinutes), endTime: minutesToTime(ctx.shift.endMinutes) },
      };
    });
    const is = (s: DayStatus) => rows.filter((r) => r.status === s).length;
    const summary = {
      total: rows.length,
      present: is('PRESENT'),
      halfDay: is('HALF_DAY'),
      absent: is('ABSENT') + is('UPCOMING'),
      inProgress: is('IN_PROGRESS'),
      missedPunch: is('MISSED_PUNCH'),
      late: rows.filter((r) => (r.record?.lateMinutes ?? 0) > 0).length,
      off: is('HOLIDAY') + is('WEEKLY_OFF'),
    };
    const filtered = query.status
      ? rows.filter((r) => (query.status === 'LATE' ? (r.record?.lateMinutes ?? 0) > 0 : query.status === 'ABSENT' ? r.status === 'ABSENT' || r.status === 'UPCOMING' : r.status === query.status))
      : rows;
    const start = (query.page - 1) * query.pageSize;
    return { date, summary, page: new PaginatedResult(filtered.slice(start, start + query.pageSize), paginationMeta(query, filtered.length)) };
  }

  // ---- HR corrections --------------------------------------------------------------------------

  async upsertRecord(auth: AuthContext, dto: UpsertRecordDto) {
    const employee = await this.resolveEmployee(auth, dto.employeeId, 'attendance.manage');
    if (dto.workDate < employee.dateOfJoining || (employee.exitDate && dto.workDate > employee.exitDate)) {
      throw AppError.validation([{ field: 'workDate', message: 'The employee was not employed on this date' }]);
    }
    const ctx = await this.rules.context(auth.organizationId!, employee);
    if (dto.workDate > this.rules.today(ctx.timeZone)) throw AppError.validation([{ field: 'workDate', message: 'Attendance cannot be recorded for a future date' }]);
    await this.rules.assertOpen(dto.workDate);
    const { checkInAt, checkOutAt } = this.rules.instants(dto.workDate, dto.checkIn, dto.checkOut, ctx.timeZone);
    if (checkOutAt && checkOutAt > new Date()) throw AppError.validation([{ field: 'checkOut', message: 'Check-out cannot be in the future' }]);
    const values = {
      shiftId: ctx.shift.id,
      checkInAt,
      checkOutAt,
      lateMinutes: this.rules.lateMinutes(checkInAt, dto.workDate, ctx),
      ...this.rules.outcome(checkInAt, checkOutAt, ctx.shift),
      source: 'MANUAL' as const,
      note: dto.note,
      updatedById: auth.userId,
    };
    const record = await this.db.transaction(async (transaction) => {
      const existing = await AttendanceRecord.findOne({ where: { employeeId: employee.id, workDate: dto.workDate }, transaction });
      const before = existing ? { checkInAt: existing.checkInAt, checkOutAt: existing.checkOutAt, status: existing.status } : null;
      const saved = existing
        ? await existing.update(values, { transaction })
        : await AttendanceRecord.create({ ...values, organizationId: auth.organizationId!, employeeId: employee.id, workDate: dto.workDate }, { transaction });
      await this.audit.record(
        {
          action: 'attendance.record_corrected',
          entityType: 'AttendanceRecord',
          entityId: saved.id,
          summary: `Attendance of ${fullName(employee)} on ${dto.workDate} corrected`,
          changes: { checkInAt: { from: before?.checkInAt ?? null, to: checkInAt }, checkOutAt: { from: before?.checkOutAt ?? null, to: checkOutAt }, status: { from: before?.status ?? null, to: saved.status } },
          metadata: { note: dto.note },
        },
        transaction,
      );
      return saved;
    });
    return presentRecord(record);
  }

  // ---- Helpers ---------------------------------------------------------------------------------

  private async requireSelf(auth: AuthContext): Promise<Employee> {
    const self = await this.scope.self(auth);
    if (!self) throw AppError.notFound('Employee record linked to your account');
    if (self.status === 'EXITED') throw AppError.forbidden('Exited employees cannot record attendance');
    return self;
  }

  /** The employee whose data is requested, within the caller's scope for `permission` (default: own record). */
  async resolveEmployee(auth: AuthContext, employeeId: string | undefined, permission = 'attendance.view'): Promise<Employee> {
    if (!employeeId) {
      const self = await this.scope.self(auth);
      if (!self) throw AppError.notFound('Employee record linked to your account');
      if (!auth.permissions.has(permission)) throw AppError.forbidden();
      return self;
    }
    const employee = await Employee.findByPk(employeeId, { attributes: EMPLOYEE_ATTRS });
    if (!employee || !(await this.scope.covers(auth, 'attendance.view', employee))) throw AppError.notFound('Employee');
    if (permission !== 'attendance.view' && !(await this.scope.covers(auth, permission, employee))) throw AppError.forbidden();
    return employee;
  }

  /** The latest punch-in without a punch-out within the last OPEN_PUNCH_HOURS (supports night shifts). */
  private findOpen(employeeId: string, now: Date) {
    return AttendanceRecord.findOne({
      where: { employeeId, checkOutAt: null, checkInAt: { [Op.gte]: new Date(now.getTime() - OPEN_PUNCH_HOURS * 3_600_000) } },
      order: [['checkInAt', 'DESC']],
    });
  }

  private localTime(instant: Date, ctx: EmployeeContext): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: ctx.timeZone, hour: '2-digit', minute: '2-digit' }).format(instant);
  }
}

