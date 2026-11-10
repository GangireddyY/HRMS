/** Attendance vocabularies shared by the API and the web app. */

/** Outcome stored on a completed attendance record. */
export const ATTENDANCE_RECORD_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT'] as const;
export type AttendanceRecordStatus = (typeof ATTENDANCE_RECORD_STATUSES)[number];

/**
 * What a calendar day means for an employee, derived from the record, shift, holidays and dates:
 * IN_PROGRESS = punched in today, not out yet; MISSED_PUNCH = a past day with a punch-in but no punch-out;
 * ABSENT = a past working day without attendance; UPCOMING = a future working day; NOT_EMPLOYED = before joining / after exit.
 */
export const DAY_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'IN_PROGRESS', 'MISSED_PUNCH', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'UPCOMING', 'NOT_EMPLOYED'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

export const ATTENDANCE_SOURCES = ['WEB', 'REGULARIZED', 'MANUAL', 'DEVICE'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

/** Where a day was worked from: the office, or remotely on an approved work-from-home day. */
export const WORK_MODES = ['OFFICE', 'REMOTE'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/** Overtime is approved (possibly for fewer minutes) before payroll pays it. */
export const OVERTIME_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type OvertimeStatus = (typeof OVERTIME_STATUSES)[number];
/** Overtime pay: approved hours × (monthly Basic or gross ÷ 26 days ÷ 8 hours) × the multiplier. */
export const OVERTIME_BASES = ['BASIC', 'GROSS'] as const;
export type OvertimeBasis = (typeof OVERTIME_BASES)[number];
export const OVERTIME_HOURLY_DIVISOR = 26 * 8;

/** Work-from-home requests cover at most this many consecutive days. */
export const WFH_MAX_DAYS = 31;

/** Device punches: IN / OUT when the device knows, AUTO = first punch of the day is in, the last is out. */
export const PUNCH_DIRECTIONS = ['IN', 'OUT', 'AUTO'] as const;
export type PunchDirection = (typeof PUNCH_DIRECTIONS)[number];
export const DEVICE_BATCH_MAX = 500;

/** Rosters are planned at most this many days at a time. */
export const ROSTER_MAX_DAYS = 92;

export const REGULARIZATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RegularizationStatus = (typeof REGULARIZATION_STATUSES)[number];

/** 0 = Sunday … 6 = Saturday (JavaScript `Date#getUTCDay`). */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Shift used when an employee has none assigned and the organization has no default shift. */
export const FALLBACK_SHIFT = {
  name: 'General (default)',
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  graceMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0, 6] as number[],
};

/** Employees can request regularization for days up to this many days in the past. */
export const REGULARIZATION_WINDOW_DAYS = 45;

// ---- Timesheets ---------------------------------------------------------------------------------

/** A weekly timesheet: saved as a draft, submitted for review, then approved or sent back (rejected). */
export const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];
/** Week status on the HR board: a timesheet's status, or no timesheet at all. */
export type TimesheetWeekStatus = TimesheetStatus | 'MISSING';

/**
 * What payroll does when a required timesheet is not approved by its due date: only flag it on the payslip, count
 * the week's working days as loss of pay, or hold the employee's salary in the run.
 */
export const TIMESHEET_MISSED_ACTIONS = ['FLAG', 'LOP', 'HOLD'] as const;
export type TimesheetMissedAction = (typeof TIMESHEET_MISSED_ACTIONS)[number];

export const TIMESHEET_MAX_ENTRIES = 80;
export const TIMESHEET_PROJECT_MAX = 120;
export const TIMESHEET_ACTIVITY_MAX = 120;
export const TIMESHEET_NOTE_MAX = 300;

/**
 * One activity on one day of the week (`day` 0 = Monday … 6 = Sunday): the project, what was done, and either a
 * From–To time range (local `HH:MM`; a range ending at or before its start runs past midnight) or just a duration.
 */
export interface TimesheetEntry {
  day: number;
  project: string;
  activity: string | null;
  start: string | null;
  end: string | null;
  minutes: number;
  note: string | null;
}

/** Minutes from `start` to `end` (`HH:MM`); an end at or before the start is on the next day. */
export function rangeMinutes(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 1440;
}

/** Payroll holds a salary with this reason when timesheets are missing; recalculating releases it once they're in. */
export const TIMESHEET_HOLD_REASON = 'Timesheets missing';

const dayNumber = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const shiftDate = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Timesheet weeks run Monday to Sunday; this is the Monday of the week containing `date`. */
export function weekStartOf(date: string): string {
  return shiftDate(date, -((dayNumber(date) + 6) % 7));
}

/** The timesheet for a week is due on the first `dueWeekday` (0 = Sunday … 6 = Saturday) after the week ends. */
export function timesheetDueDate(weekStart: string, dueWeekday: number): string {
  const sunday = shiftDate(weekStart, 6);
  for (let i = 1; i <= 7; i++) {
    const d = shiftDate(sunday, i);
    if (dayNumber(d) === dueWeekday) return d;
  }
  return shiftDate(sunday, 1);
}

/** Countries whose official holiday calendar can be imported into the organization's holidays. */
export const HOLIDAY_COUNTRIES = {
  IN: 'India',
  AE: 'United Arab Emirates',
  AU: 'Australia',
  BD: 'Bangladesh',
  CA: 'Canada',
  DE: 'Germany',
  FR: 'France',
  GB: 'United Kingdom',
  IE: 'Ireland',
  JP: 'Japan',
  LK: 'Sri Lanka',
  MY: 'Malaysia',
  NP: 'Nepal',
  NZ: 'New Zealand',
  PH: 'Philippines',
  QA: 'Qatar',
  SA: 'Saudi Arabia',
  SG: 'Singapore',
  US: 'United States',
  ZA: 'South Africa',
} as const;
export type HolidayCountry = keyof typeof HOLIDAY_COUNTRIES;
/** PUBLIC = a national day off; REGIONAL = a day off only in some states or regions; OBSERVANCE = marked but not a day off. */
export const OFFICIAL_HOLIDAY_KINDS = ['PUBLIC', 'REGIONAL', 'OBSERVANCE'] as const;
export type OfficialHolidayKind = (typeof OFFICIAL_HOLIDAY_KINDS)[number];
export const HOLIDAY_IMPORT_MAX = 100;
