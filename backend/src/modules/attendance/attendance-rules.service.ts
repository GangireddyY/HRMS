import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { FALLBACK_SHIFT, type AttendanceRecordStatus, type DayStatus } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { addDays, timeToMinutes, weekday, zonedInstant, zonedParts } from '../../common/utils/zoned-time';
import { AttendancePeriod, Employee, Holiday, Location, Organization, Shift, type AttendanceRecord } from '../../database/models';

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
}

export interface EmployeeContext {
  shift: EffectiveShift;
  timeZone: string;
}

/** A punch-in older than this without a punch-out is no longer "open" (a forgotten punch-out). */
export const OPEN_PUNCH_HOURS = 20;

function toEffective(s: Pick<Shift, 'name' | 'startTime' | 'endTime' | 'breakMinutes' | 'graceMinutes' | 'halfDayMinutes' | 'fullDayMinutes' | 'weeklyOffs'> & { id?: string | null }): EffectiveShift {
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
  };
}

/** Shared attendance rules: shifts, time zones, holidays, month closing and day outcomes. */
@Injectable()
export class AttendanceRulesService {
  async organizationTimeZone(organizationId: string): Promise<string> {
    const org = await Organization.findByPk(organizationId, { attributes: ['timezone'] });
    return org?.timezone ?? 'UTC';
  }

  /** Effective shift (assigned → organization default → built-in) and time zone (location → organization) per employee. */
  async contexts(organizationId: string, employees: Pick<Employee, 'id' | 'shiftId' | 'locationId'>[]): Promise<Map<string, EmployeeContext>> {
    const [orgTz, defaultShift] = await Promise.all([this.organizationTimeZone(organizationId), Shift.findOne({ where: { isDefault: true } })]);
    const shiftIds = [...new Set(employees.map((e) => e.shiftId).filter((x): x is string => !!x))];
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
        { shift: (e.shiftId && shiftById.get(e.shiftId)) || fallback, timeZone: (e.locationId && tzByLocation.get(e.locationId)) || orgTz },
      ]),
    );
  }

  async context(organizationId: string, employee: Pick<Employee, 'id' | 'shiftId' | 'locationId'>): Promise<EmployeeContext> {
    return (await this.contexts(organizationId, [employee])).get(employee.id)!;
  }

  /** Public holidays in the range (optional holidays are returned too; they stay working days). */
  async holidays(from: string, to: string): Promise<Map<string, Holiday>> {
    const rows = await Holiday.findAll({ where: { date: { [Op.between]: [from, to] } } });
    return new Map(rows.map((h) => [h.date, h]));
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

  /** Minutes after the shift start, when the punch-in is beyond the grace period (else 0). */
  lateMinutes(checkIn: Date, workDate: string, ctx: EmployeeContext): number {
    const start = zonedInstant(workDate, ctx.shift.startMinutes, ctx.timeZone);
    const late = Math.floor((checkIn.getTime() - start.getTime()) / 60_000);
    return late > ctx.shift.graceMinutes ? late : 0;
  }

  /** Converts local `HH:MM` punch times on `workDate` to instants; a check-out at or before the check-in is the next day. */
  instants(workDate: string, checkIn: string, checkOut: string | null | undefined, timeZone: string): { checkInAt: Date; checkOutAt: Date | null } {
    const inMinutes = timeToMinutes(checkIn);
    const checkInAt = zonedInstant(workDate, inMinutes, timeZone);
    if (!checkOut) return { checkInAt, checkOutAt: null };
    const outMinutes = timeToMinutes(checkOut);
    return { checkInAt, checkOutAt: zonedInstant(workDate, outMinutes <= inMinutes ? outMinutes + 1440 : outMinutes, timeZone) };
  }

  dayStatus(
    date: string,
    today: string,
    employee: Pick<Employee, 'dateOfJoining' | 'exitDate'>,
    ctx: EmployeeContext,
    holiday: Holiday | undefined,
    record: Pick<AttendanceRecord, 'checkInAt' | 'checkOutAt' | 'status'> | undefined,
  ): DayStatus {
    if (date < employee.dateOfJoining || (employee.exitDate && date > employee.exitDate)) return 'NOT_EMPLOYED';
    if (record?.checkInAt) {
      if (record.checkOutAt && record.status) return record.status;
      const stillOpen = date === today || (ctx.shift.crossesMidnight && date === addDays(today, -1));
      return stillOpen ? 'IN_PROGRESS' : 'MISSED_PUNCH';
    }
    if (holiday && !holiday.isOptional) return 'HOLIDAY';
    if (ctx.shift.weeklyOffs.includes(weekday(date))) return 'WEEKLY_OFF';
    return date >= today ? 'UPCOMING' : 'ABSENT';
  }
}
