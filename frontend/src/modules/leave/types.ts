import type { AccrualFrequency, LeaveGender, LeaveRequestStatus, LeaveSession, LedgerKind, ManualLedgerKind } from '@contracts';

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  isPaid: boolean;
  unlimited: boolean;
  annualQuota: number;
  accrualFrequency: AccrualFrequency;
  prorateOnJoining: boolean;
  carryForwardLimit: number;
  encashable: boolean;
  allowHalfDay: boolean;
  allowNegativeBalance: boolean;
  countNonWorkingDays: boolean;
  minNoticeDays: number;
  maxBackdatedDays: number;
  maxConsecutiveDays: number | null;
  eligibleAfterDays: number;
  applicableGender: LeaveGender | null;
  isActive: boolean;
}

export type LeaveTypeInput = Omit<LeaveType, 'id'>;

export interface LeaveSettings {
  leaveYearStartMonth: number;
  timeZone: string;
}

export interface LeaveTypeRef {
  id: string;
  code: string;
  name: string;
  color: string;
}

export interface Balance {
  leaveType: LeaveTypeRef & { isPaid: boolean; unlimited: boolean; allowHalfDay: boolean; encashable: boolean };
  opening: number;
  accrued: number;
  granted: number;
  adjusted: number;
  taken: number;
  encashed: number;
  lapsed: number;
  balance: number | null;
  pending: number;
  available: number | null;
}

export interface Balances {
  employee: { id: string; name: string; employeeCode: string };
  year: number;
  currentYear: number;
  range: { from: string; to: string };
  balances: Balance[];
}

export interface BalanceOverview {
  year: number;
  currentYear: number;
  types: (LeaveTypeRef & { unlimited: boolean })[];
  items: {
    employee: { id: string; name: string; employeeCode: string; department: string | null };
    balances: { leaveTypeId: string; balance: number | null; available: number | null; pending: number; taken: number }[];
  }[];
  meta: import('@contracts').PaginationMeta;
}

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  days: number;
  effectiveDate: string;
  note: string | null;
  leaveType: LeaveTypeRef;
  request: { id: string; startDate: string; endDate: string } | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LeaveRequest {
  id: string;
  employee: { id: string; name: string; employeeCode: string; department: string | null } | null;
  leaveType: (LeaveTypeRef & { isPaid: boolean }) | null;
  leaveYear: number;
  startDate: string;
  endDate: string;
  startSession: LeaveSession;
  endSession: LeaveSession;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface LeaveRequestInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  startSession?: LeaveSession;
  endSession?: LeaveSession;
  reason?: string;
}

export interface LeaveQuote {
  days: number;
  breakdown: { date: string; portion: number; skipped?: 'WEEKLY_OFF' | 'HOLIDAY' }[];
  leaveYear: number;
  available: number | null;
  remainingAfter: number | null;
  issues: { field: string; message: string }[];
}

export interface LeaveCalendar {
  month: string;
  days: string[];
  holidays: { date: string; name: string; isOptional: boolean }[];
  entries: {
    id: string;
    employee: { id: string; name: string; employeeCode: string; department: string | null };
    leaveType: LeaveTypeRef;
    startDate: string;
    endDate: string;
    startSession: LeaveSession;
    endSession: LeaveSession;
    days: number;
    status: LeaveRequestStatus;
  }[];
}

export interface AdjustmentInput {
  employeeId: string;
  leaveTypeId: string;
  kind: ManualLedgerKind;
  days: number;
  note: string;
}
