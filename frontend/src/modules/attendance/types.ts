import type { AttendanceRecordStatus, AttendanceSource, DayStatus, RegularizationStatus } from '@contracts';

export interface AttendanceRecord {
  id: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  workedMinutes: number | null;
  lateMinutes: number;
  status: AttendanceRecordStatus | null;
  source: AttendanceSource;
  note: string | null;
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
}

export interface TodayAttendance {
  employee: { id: string; name: string; employeeCode: string; status: string } | null;
  date?: string;
  timeZone?: string;
  shift?: ShiftSummary;
  holiday?: { name: string; isOptional: boolean } | null;
  isWeeklyOff?: boolean;
  record?: AttendanceRecord | null;
  openRecord?: AttendanceRecord | null;
  periodClosed?: boolean;
  serverTime?: string;
}

export interface CalendarDay {
  date: string;
  status: DayStatus;
  holiday: { name: string; isOptional: boolean } | null;
  record: AttendanceRecord | null;
  pendingRegularizationId: string | null;
}

export interface AttendanceCalendar {
  employee: { id: string; name: string; employeeCode: string };
  month: string;
  timeZone: string;
  shift: ShiftSummary;
  closed: boolean;
  today: string;
  days: CalendarDay[];
  summary: { present: number; halfDay: number; absent: number; missedPunch: number; holidays: number; weeklyOffs: number; lateDays: number; workedMinutes: number };
}

export interface DailyRow {
  employee: { id: string; name: string; employeeCode: string; department: { id: string; name: string } | null; designation: string | null };
  status: DayStatus;
  record: AttendanceRecord | null;
  shift: { name: string; startTime: string; endTime: string };
}

export interface DailySummary {
  total: number;
  present: number;
  halfDay: number;
  absent: number;
  inProgress: number;
  missedPunch: number;
  late: number;
  off: number;
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
  isDefault: boolean;
  isActive: boolean;
  employeeCount: number;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  isOptional: boolean;
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
}
