import { Injectable } from '@nestjs/common';
import { Op, type Transaction } from 'sequelize';
import { FALLBACK_SHIFT, type AttendanceRecordStatus, type DayStatus, type LeaveSession } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { addDays, timeToMinutes, weekday, zonedInstant, zonedParts } from '../../common/utils/zoned-time';
import { AttendancePeriod, Employee, Holiday, LeaveRequest, LeaveType, Location, Organization, Shift, ShiftAssignment, WorkFromHomeRequest, type AttendanceRecord } from '../../database/models';

/** Approved leave on one day (from the leave module). */
export interface DayLeave {
  requestId: string;
  code: string;
  name: string;
  color: string;
  isPaid: boolean;
  session: LeaveSession;
  countsNonWorkingDays: boolean;
}

export interface EffectiveShift {
  id: string | null;
  name: string;
  startMinutes: number;
  endMinutes: number;
  /** End time is on the next calendar day. */
  crossesMidnight: boolean;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  overtimeEnabled: boolean;
  overtimeAfterMinutes: number;
  overtimeMinMinutes: number;
}

/** A roster entry: the shift worked from `from` to `to` (null = rostered day off). */
export interface RosterSpan {
  from: string;
  to: string;
  shift: EffectiveShift | null;
}

export interface EmployeeContext {
  /** The usual shift (assigned → organization default → built-in). */
  shift: EffectiveShift;
  timeZone: string;
  /** Roster entries loaded for the dates being looked at; they override the usual shift. */
  roster: RosterSpan[];
}

/** What a record's punches amount to. */
export interface DayOutcome {
  shiftId: string | null;
  lateMinutes: number;
  workedMinutes: number | null;
  status: AttendanceRecordStatus | null;
  overtimeMinutes: number;
}

/** A punch-in older than this without a punch-out is no longer "open" (a forgotten punch-out). */
export const OPEN_PUNCH_HOURS = 20;
/** Days around today loaded for the roster when no range is given. */
const DEFAULT_ROSTER_WINDOW = 45;

type ShiftFields = Pick<Shift, 'name' | 'startTime' | 'endTime' | 'breakMinutes' | 'graceMinutes' | 'halfDayMinutes' | 'fullDayMinutes' | 'weeklyOffs'> &
  Partial<Pick<Shift, 'overtimeEnabled' | 'overtimeAfterMinutes' | 'overtimeMinMinutes'>> & { id?: string | null };

function toEffective(s: ShiftFields): EffectiveShift {
  const startMinutes = timeToMinutes(s.startTime);
  const endMinutes = timeToMinutes(s.endTime);
  return {
    id: s.id ?? null,
    name: s.name,
    startMinutes,
    endMinutes,
    crossesMidnight: endMinutes <= startMinutes,
    breakMinutes: s.breakMinutes,
    graceMinutes: s.graceMinutes,
    halfDayMinutes: s.halfDayMinutes,
    fullDayMinutes: s.fullDayMinutes,
    weeklyOffs: (s.weeklyOffs ?? []).map(Number),
    overtimeEnabled: s.overtimeEnabled ?? false,
    overtimeAfterMinutes: s.overtimeAfterMinutes ?? 540,
    overtimeMinMinutes: s.overtimeMinMinutes ?? 30,
  };
}

/** Distance in metres between two points (haversine). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

/** Overtime in minutes: beyond the shift's threshold, or everything worked on a day off; nothing below the minimum. */
export function overtimeMinutes(workedMinutes: number | null, shift: EffectiveShift, dayOff: boolean): number {
  if (!shift.overtimeEnabled || !workedMinutes) return 0;
  const extra = dayOff ? workedMinutes : workedMinutes - shift.overtimeAfterMinutes;
  return extra > 0 && extra >= shift.overtimeMinMinutes ? extra : 0;
}

/** Shared attendance rules: shifts and rosters, time zones, holidays, month closing and day outcomes. */
@Injectable()
export class AttendanceRulesService {
  async organizationTimeZone(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return org?.timezone ?? 'UTC';
  }

  /**
   * Effective shift (assigned → organization default → built-in), roster for the range and time zone (location →
   * organization) per employee.
   */
  async contexts(organizationId: string, employees: Pick<Employee, 'id' | 'shiftId' | 'locationId'>[], range?: { from: string; to: string }): Promise<Map<string, EmployeeContext>> {
    const [orgTz, defaultShift] = await Promise.all([this.organizationTimeZone(organizationId), Shift.findOne({ where: { isDefault: true } })]);
    const today = zonedParts(new Date(), orgTz).date;
    const window = range ?? { from: addDays(today, -DEFAULT_ROSTER_WINDOW), to: addDays(today, DEFAULT_ROSTER_WINDOW) };
    const ids = employees.map((e) => e.id);
    const assignments = ids.length
      ? await ShiftAssignment.findAll({ where: { employeeId: ids, startDate: { [Op.lte]: addDays(window.to, 1) }, endDate: { [Op.gte]: addDays(window.from, -1) } }, order: [['startDate', 'ASC']] })
      : [];
    const shiftIds = [...new Set([...employees.map((e) => e.shiftId), ...assignments.map((a) => a.shiftId)].filter((x): x is string => !!x))];
    const locationIds = [...new Set(employees.map((e) => e.locationId).filter((x): x is string => !!x))];
    const [shifts, locations] = await Promise.all([
      shiftIds.length ? Shift.findAll({ where: { id: shiftIds } }) : [],
      locationIds.length ? Location.findAll({ where: { id: locationIds }, attributes: ['id', 'timezone'] }) : [],
    ]);
    const shiftById = new Map(shifts.map((s) => [s.id, toEffective(s)]));
    const tzByLocation = new Map(locations.map((l) => [l.id, l.timezone]));
    const fallback = defaultShift ? toEffective(defaultShift) : toEffective(FALLBACK_SHIFT);
    return new Map(
      employees.map((e) => [
        e.id,
        {
          shift: (e.shiftId && shiftById.get(e.shiftId)) || fallback,
          timeZone: (e.locationId && tzByLocation.get(e.locationId)) || orgTz,
          roster: assignments.filter((a) => a.employeeId === e.id).map((a) => ({ from: a.startDate, to: a.endDate, shift: a.shiftId ? (shiftById.get(a.shiftId) ?? null) : null })),
        },
      ]),
    );
  }

  async context(organizationId: string, employee: Pick<Employee, 'id' | 'shiftId' | 'locationId'>, range?: { from: string; to: string }): Promise<EmployeeContext> {
    return (await this.contexts(organizationId, [employee], range)).get(employee.id)!;
  }

  /** The roster entry covering a date, if any. */
  rosterOn(ctx: EmployeeContext, date: string): RosterSpan | undefined {
    return ctx.roster.find((r) => r.from <= date && r.to >= date);
  }

  /** The shift worked on a date: the rostered shift, else the usual one (also on rostered days off). */
  shiftOn(ctx: EmployeeContext, date: string): EffectiveShift {
    return this.rosterOn(ctx, date)?.shift ?? ctx.shift;
  }

  /** A rostered day off, or a weekly off of the shift worked that day. */
  isRestDay(ctx: EmployeeContext, date: string): boolean {
    const r = this.rosterOn(ctx, date);
    if (r && !r.shift) return true;
    return (r?.shift ?? ctx.shift).weeklyOffs.includes(weekday(date));
  }

  /** Public holidays in the range (optional holidays are returned too; they stay working days). */
  async holidays(from: string, to: string): Promise<Map<string, Holiday>> {
    const rows = await Holiday.findAll({ where: { date: { [Op.between]: [from, to] } } });
    return new Map(rows.map((h) => [h.date, h]));
  }

  /** Days of approved work from home per employee in a range. */
  async workFromHomeDays(employeeIds: string[], from: string, to: string, transaction?: Transaction): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!employeeIds.length) return out;
    const rows = await WorkFromHomeRequest.findAll({ where: { employeeId: employeeIds, status: 'APPROVED', startDate: { [Op.lte]: to }, endDate: { [Op.gte]: from } }, transaction });
    for (const r of rows) {
      const days = out.get(r.employeeId) ?? new Set<string>();
      for (let d = r.startDate < from ? from : r.startDate; d <= r.endDate && d <= to; d = addDays(d, 1)) days.add(d);
      out.set(r.employeeId, days);
    }
    return out;
  }

  async isClosed(date: string): Promise<boolean> {
    const [y, m] = date.split('-').map(Number);
    return (await AttendancePeriod.count({ where: { year: y, month: m } })) > 0;
  }

  async assertOpen(date: string): Promise<void> {
    if (await this.isClosed(date)) {
      throw AppError.conflict(`Attendance for ${date.slice(0, 7)} is closed. Ask your HR team to reopen the month first.`);
    }
  }

  today(timeZone: string, now = new Date()): string {
    return zonedParts(now, timeZone).date;
  }

  /** Worked minutes (punch-in to punch-out, breaks included) and the resulting status. */
  outcome(checkIn: Date, checkOut: Date | null, shift: EffectiveShift): { workedMinutes: number | null; status: AttendanceRecordStatus | null } {
    if (!checkOut) return { workedMinutes: null, status: null };
    const workedMinutes = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000));
    const status: AttendanceRecordStatus = workedMinutes >= shift.fullDayMinutes ? 'PRESENT' : workedMinutes >= shift.halfDayMinutes ? 'HALF_DAY' : 'ABSENT';
    return { workedMinutes, status };
  }

  /** Everything a record's punches amount to on a work date: shift, lateness, worked time, status and overtime. */
  async evaluate(ctx: EmployeeContext, workDate: string, checkIn: Date, checkOut: Date | null, transaction?: Transaction): Promise<DayOutcome> {
    const shift = this.shiftOn(ctx, workDate);
    const holiday = await Holiday.findOne({ where: { date: workDate, isOptional: false }, attributes: ['id'], transaction });
    const dayOff = !!holiday || this.isRestDay(ctx, workDate);
    const { workedMinutes, status } = this.outcome(checkIn, checkOut, shift);
    return { shiftId: shift.id, lateMinutes: dayOff ? 0 : this.lateMinutes(checkIn, workDate, ctx), workedMinutes, status, overtimeMinutes: overtimeMinutes(workedMinutes, shift, dayOff) };
  }

  /** Minutes after the shift start, when the punch-in is beyond the grace period (else 0). */
  lateMinutes(checkIn: Date, workDate: string, ctx: EmployeeContext): number {
    const shift = this.shiftOn(ctx, workDate);
    const start = zonedInstant(workDate, shift.startMinutes, ctx.timeZone);
    const late = Math.floor((checkIn.getTime() - start.getTime()) / 60_000);
    return late > shift.graceMinutes ? late : 0;
  }

  /** Converts local `HH:MM` punch times on `workDate` to instants; a check-out at or before the check-in is the next day. */
  instants(workDate: string, checkIn: string, checkOut: string | null | undefined, timeZone: string): { checkInAt: Date; checkOutAt: Date | null } {
    const inMinutes = timeToMinutes(checkIn);
    const checkInAt = zonedInstant(workDate, inMinutes, timeZone);
    if (!checkOut) return { checkInAt, checkOutAt: null };
    const outMinutes = timeToMinutes(checkOut);
    return { checkInAt, checkOutAt: zonedInstant(workDate, outMinutes <= inMinutes ? outMinutes + 1440 : outMinutes, timeZone) };
  }

  /**
   * The work date a punch belongs to: the local date, except early-morning punches that end yesterday's night shift
   * (up to four hours after its scheduled end).
   */
  workDateOf(instant: Date, ctx: EmployeeContext): string {
    const { date, minutes } = zonedParts(instant, ctx.timeZone);
    const yesterday = addDays(date, -1);
    const shift = this.shiftOn(ctx, yesterday);
    if (shift.crossesMidnight && !this.isRestDay(ctx, yesterday) && minutes <= shift.endMinutes + 240) return yesterday;
    return date;
  }

  /** Approved leave per employee and date in a range. */
  async approvedLeave(employeeIds: string[], from: string, to: string): Promise<Map<string, Map<string, DayLeave>>> {
    const out = new Map<string, Map<string, DayLeave>>();
    if (!employeeIds.length) return out;
    const rows = await LeaveRequest.findAll({
      where: { employeeId: employeeIds, status: 'APPROVED', startDate: { [Op.lte]: to }, endDate: { [Op.gte]: from } },
      include: [{ model: LeaveType, attributes: ['code', 'name', 'color', 'countNonWorkingDays', 'isPaid'] }],
    });
    for (const r of rows) {
      const byDate = out.get(r.employeeId) ?? new Map<string, DayLeave>();
      for (let d = r.startDate < from ? from : r.startDate; d <= r.endDate && d <= to; d = addDays(d, 1)) {
        const session = r.startDate === r.endDate ? r.startSession : d === r.startDate && r.startSession === 'SECOND_HALF' ? 'SECOND_HALF' : d === r.endDate && r.endSession === 'FIRST_HALF' ? 'FIRST_HALF' : 'FULL';
        byDate.set(d, { requestId: r.id, code: r.leaveType!.code, name: r.leaveType!.name, color: r.leaveType!.color, isPaid: r.leaveType!.isPaid, session, countsNonWorkingDays: r.leaveType!.countNonWorkingDays });
      }
      out.set(r.employeeId, byDate);
    }
    return out;
  }

  dayStatus(
    date: string,
    today: string,
    employee: Pick<Employee, 'dateOfJoining' | 'exitDate'>,
    ctx: EmployeeContext,
    holiday: Holiday | undefined,
    record: Pick<AttendanceRecord, 'checkInAt' | 'checkOutAt' | 'status'> | undefined,
    leave?: DayLeave,
  ): DayStatus {
    if (date < employee.dateOfJoining || (employee.exitDate && date > employee.exitDate)) return 'NOT_EMPLOYED';
    if (record?.checkInAt) {
      if (record.checkOutAt && record.status) return record.status;
      const stillOpen = date === today || (this.shiftOn(ctx, date).crossesMidnight && date === addDays(today, -1));
      return stillOpen ? 'IN_PROGRESS' : 'MISSED_PUNCH';
    }
    const rest = this.isRestDay(ctx, date);
    const offDay = (holiday && !holiday.isOptional) || rest;
    if (leave && (!offDay || leave.countsNonWorkingDays)) return 'ON_LEAVE';
    if (holiday && !holiday.isOptional) return 'HOLIDAY';
    if (rest) return 'WEEKLY_OFF';
    return date >= today ? 'UPCOMING' : 'ABSENT';
  }
}
