import type { AccrualFrequency, CompOffDayKind, EmploymentType, LeaveEncashmentStatus, LeaveGender, LeaveRequestStatus, LeaveSession, LedgerKind, ManualLedgerKind } from '@contracts';

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
  /** Set on the comp-off type: credits for working on a day off expire after this many days. */
  compOffValidityDays: number | null;
  /** 2 = manager, then HR. */
  approvalLevels: number;
  /** With two levels: only requests longer than this need HR. */
  secondApprovalMinDays: number | null;
  /** Who it applies to besides gender; null = everyone. */
  locationIds: string[] | null;
  employmentTypes: EmploymentType[] | null;
  gradeIds: string[] | null;
  /** Accrual stops at this balance. */
  maxBalance: number | null;
  encashMaxDays: number | null;
  encashMinBalance: number;
  isActive: boolean;
}

export interface EncashmentOption {
  leaveType: { id: string; code: string; name: string; color: string };
  available: number;
  keep: number;
  yearlyLimit: number | null;
  usedThisYear: number;
  max: number;
  blocked: string | null;
}

export interface Encashment {
  id: string;
  employee: { id: string; name: string; employeeCode: string } | null;
  leaveType: { id: string; code: string; name: string; color: string } | null;
  leaveYear: number;
  days: number;
  reason: string | null;
  status: LeaveEncashmentStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  payrollRunId: string | null;
  amount: number | null;
  paidAt: string | null;
  createdAt: string;
  permissions: { review: boolean; cancel: boolean };
}

export interface CompOffRequest {
  id: string;
  workDate: string;
  dayKind: CompOffDayKind;
  dayLabel: string | null;
  workedMinutes: number;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  expiresOn: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  employee: { id: string; name: string; employeeCode: string } | null;
  permissions: { review: boolean; cancel: boolean };
}

export interface CompOffEligibility {
  enabled: boolean;
  leaveType: { id: string; code: string; name: string; validityDays: number } | null;
  windowDays: number;
  days: { date: string; kind: CompOffDayKind; label: string | null; workedMinutes: number; maxDays: 0.5 | 1; request: { id: string; status: LeaveRequestStatus; days: number } | null }[];
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
  approval: { level: number; levels: number; awaiting: string | null; trail: { level: number; name: string; at: string; note: string | null }[] };
  /** Team view: whether you can approve at the current level. */
  canApprove?: boolean;
  /** Team view: you'd decide on behalf of this person (approval cover). */
  onBehalfOf?: string | null;
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
  holidays: { date: string; name: string; isOptional: boolean; locations: string[] }[];
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
