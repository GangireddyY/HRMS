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

export const ATTENDANCE_SOURCES = ['WEB', 'REGULARIZED', 'MANUAL'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

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
