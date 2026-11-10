import type {
  AttendanceRecordStatus,
  AttendanceSource,
  DayStatus,
  HolidayCountry,
  LeaveSession,
  OfficialHolidayKind,
  OvertimeStatus,
  RegularizationStatus,
  ShiftSwapStatus,
  TimesheetEntry,
  TimesheetMissedAction,
  TimesheetStatus,
  TimesheetWeekStatus,
  WorkMode,
} from '@contracts';

export interface AttendanceRecord {
  id: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  lateMinutes: number;
  overtimeMinutes: number;
  status: AttendanceRecordStatus | null;
  source: AttendanceSource;
  workMode: WorkMode;
  note: string | null;
  /** A photo was taken at punch-in. */
  hasPhoto?: boolean;
}

export interface ShiftSwap {
  id: string;
  workDate: string;
  requester: { id: string; name: string; employeeCode: string; shift: { id: string; name: string; startTime: string; endTime: string } | null };
  colleague: { id: string; name: string; employeeCode: string; shift: { id: string; name: string; startTime: string; endTime: string } | null };
  reason: string;
  status: ShiftSwapStatus;
  colleagueNote: string | null;
  colleagueRespondedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  onBehalfOf: string | null;
  permissions: { respond: boolean; cancel: boolean; review: boolean };
}

export interface ShiftSummary {
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  weeklyOffs: number[];
  overtimeEnabled: boolean;
}

export interface TodayAttendance {
  employee: { id: string; name: string; employeeCode: string; status: string } | null;
  date?: string;
  timeZone?: string;
  shift?: ShiftSummary;
  /** Today's shift comes from the roster. */
  rostered?: boolean;
  holiday?: { name: string; isOptional: boolean } | null;
  isWeeklyOff?: boolean;
  workFromHome?: boolean;
  /** Punch-ins must come from within the radius of the office. */
  geofence?: { location: string; radiusMetres: number } | null;
  /** Punch-ins must come from the office network; whether this connection is on it. */
  officeNetwork?: { location: string; onNetwork: boolean } | null;
  /** Punch-ins need a camera photo. */
  photoRequired?: boolean;
  record?: AttendanceRecord | null;
  openRecord?: AttendanceRecord | null;
  periodClosed?: boolean;
  serverTime?: string;
}

export interface CalendarDay {
  date: string;
  status: DayStatus;
  holiday: { name: string; isOptional: boolean } | null;
  /** Approved leave on this day. */
  leave: { code: string; name: string; color: string; session: LeaveSession; isPaid: boolean } | null;
  record: AttendanceRecord | null;
  pendingRegularizationId: string | null;
  shift: { name: string; startTime: string; endTime: string; rostered: boolean };
  workFromHome: boolean;
  overtime: { status: OvertimeStatus; minutes: number } | null;
}

export interface AttendanceCalendar {
  employee: { id: string; name: string; employeeCode: string; biometricCode: string | null };
  month: string;
  timeZone: string;
  shift: ShiftSummary;
  closed: boolean;
  today: string;
  days: CalendarDay[];
  summary: { present: number; halfDay: number; absent: number; missedPunch: number; onLeave: number; holidays: number; weeklyOffs: number; lateDays: number; workedMinutes: number; workFromHomeDays: number; overtimeMinutes: number };
}

export interface DailyRow {
  employee: { id: string; name: string; employeeCode: string; department: { id: string; name: string } | null; designation: string | null };
  status: DayStatus;
  leave: { code: string; name: string; color: string; session: LeaveSession } | null;
  record: AttendanceRecord | null;
  workFromHome: boolean;
  shift: { name: string; startTime: string; endTime: string; rostered: boolean };
}

export interface DailySummary {
  total: number;
  present: number;
  halfDay: number;
  absent: number;
  inProgress: number;
  missedPunch: number;
  onLeave: number;
  late: number;
  off: number;
  remote: number;
}

export interface Regularization {
  id: string;
  workDate: string;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
  status: RegularizationStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string } | null;
}

export interface Overtime {
  id: string;
  workDate: string;
  minutes: number;
  approvedMinutes: number | null;
  status: OvertimeStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  paidIn: string | null;
  employee: { id: string; name: string; employeeCode: string } | null;
  record: { checkInAt: string | null; checkOutAt: string | null; workedMinutes: number | null } | null;
  permissions: { review: boolean };
}

export interface WorkFromHome {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: RegularizationStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string } | null;
  permissions: { review: boolean; cancel: boolean };
}

export type TimesheetDayKind = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE' | 'NOT_EMPLOYED';

export interface TimesheetDay {
  date: string;
  kind: TimesheetDayKind;
  label: string | null;
  expectedMinutes: number;
  workedMinutes: number | null;
  checkIn: string | null;
  checkOut: string | null;
  future: boolean;
}

export interface TimesheetRulesView {
  required: boolean;
  dueWeekday: number;
  missedAction: TimesheetMissedAction;
  from: string | null;
}

export interface Timesheet {
  id: string;
  weekStart: string;
  weekEnd: string;
  dueDate: string;
  status: TimesheetStatus;
  entries: TimesheetEntry[];
  totalMinutes: number;
  dayTotals: number[];
  note: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  updatedAt: string;
  employee: { id: string; name: string; employeeCode: string; department: string | null } | null;
  permissions: { review: boolean; withdraw: boolean };
}

export interface TimesheetDetail extends Timesheet {
  days: TimesheetDay[];
}

export interface TimesheetWeek {
  weekStart: string;
  weekEnd: string;
  today: string;
  dueDate: string;
  rules: TimesheetRulesView;
  days: TimesheetDay[];
  timesheet: Timesheet | null;
  previous: { weekStart: string; entries: TimesheetEntry[] } | null;
  canEdit: boolean;
}

export interface TimesheetBoardRow {
  employee: { id: string; name: string; employeeCode: string; department: string | null };
  status: TimesheetWeekStatus;
  timesheetId: string | null;
  totalMinutes: number;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface TimesheetBoard {
  weekStart: string;
  weekEnd: string;
  dueDate: string;
  overdue: boolean;
  rules: TimesheetRulesView;
  summary: Record<TimesheetWeekStatus, number> & { total: number };
  items: TimesheetBoardRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: number[];
  overtimeEnabled: boolean;
  overtimeAfterMinutes: number;
  overtimeMinMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  employeeCount: number;
}

export interface RotationStep {
  shiftId: string | null;
  days: number;
}

export interface Rotation {
  id: string;
  name: string;
  isActive: boolean;
  cycleDays: number;
  pattern: (RotationStep & { shiftName: string | null })[];
}

export interface RosterDay {
  date: string;
  rostered: boolean;
  off: boolean;
  shiftId: string | null;
  shiftName: string;
  time: string;
}

export interface RosterRow {
  employee: { id: string; name: string; employeeCode: string; department: string | null };
  usualShift: { id: string | null; name: string };
  days: RosterDay[];
}

export interface Device {
  id: string;
  name: string;
  locationId: string | null;
  location?: { id: string; name: string } | null;
  serialNumber: string | null;
  keyHint: string;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  punchesLast24h?: number;
  /** Only when the device is added or its key is replaced. */
  apiKey?: string;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  isOptional: boolean;
  /** Empty = every location. */
  locationIds: string[];
  locations: { id: string; name: string }[];
}

export interface HolidayInput {
  date: string;
  name: string;
  isOptional: boolean;
  locationIds?: string[];
}

export interface OfficialHoliday {
  date: string;
  name: string;
  kind: OfficialHolidayKind;
  /** States or regions where a regional holiday is a day off. */
  regions: string[];
  halfDay: boolean;
  /** Name of the organization's holiday already on this date. */
  existing: string | null;
}

export interface OfficialHolidays {
  country: HolidayCountry;
  countryName: string;
  year: number;
  holidays: OfficialHoliday[];
}

export interface AttendancePeriod {
  year: number;
  month: number;
  ended: boolean;
  closed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  summary: Record<string, number> | null;
  pendingRegularizations: number;
  pendingOvertime: number;
}
