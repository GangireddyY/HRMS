/** Leave vocabularies shared by the API and the web app. */

/** YEARLY = the full quota at the start of the leave year; MONTHLY = 1/12 at the start of every month; NONE = granted by HR only. */
export const ACCRUAL_FREQUENCIES = ['YEARLY', 'MONTHLY', 'NONE'] as const;
export type AccrualFrequency = (typeof ACCRUAL_FREQUENCIES)[number];

export const LEAVE_GENDERS = ['FEMALE', 'MALE'] as const;
export type LeaveGender = (typeof LEAVE_GENDERS)[number];

export const LEAVE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/** FULL = the whole day; FIRST_HALF / SECOND_HALF = morning / afternoon. */
export const LEAVE_SESSIONS = ['FULL', 'FIRST_HALF', 'SECOND_HALF'] as const;
export type LeaveSession = (typeof LEAVE_SESSIONS)[number];

/**
 * Balance ledger entries (signed days). The balance of a type in a leave year is the sum of its entries.
 * ACCRUAL / CARRY_FORWARD / GRANT credit; LAPSE / ENCASHMENT / TAKEN debit; ADJUSTMENT either way; REVERSAL returns a cancelled approval.
 */
export const LEDGER_KINDS = ['ACCRUAL', 'CARRY_FORWARD', 'LAPSE', 'GRANT', 'ADJUSTMENT', 'ENCASHMENT', 'TAKEN', 'REVERSAL'] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Kinds HR records by hand (leave.allocate). */
export const MANUAL_LEDGER_KINDS = ['GRANT', 'ADJUSTMENT', 'ENCASHMENT'] as const;
export type ManualLedgerKind = (typeof MANUAL_LEDGER_KINDS)[number];

/** Leave type code, e.g. CL, EL, SL, LOP. */
export const LEAVE_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;
export const LEAVE_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Longest single request, in calendar days. */
export const LEAVE_MAX_SPAN_DAYS = 366;

/**
 * Starting point offered to new organizations (created only when an administrator chooses to);
 * every value can be changed afterwards.
 */
export const RECOMMENDED_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', color: '#0ea5e9', isPaid: true, annualQuota: 12, accrualFrequency: 'YEARLY', prorateOnJoining: true, carryForwardLimit: 0, allowHalfDay: true, minNoticeDays: 1, maxBackdatedDays: 3, maxConsecutiveDays: 3 },
  { code: 'SL', name: 'Sick leave', color: '#f43f5e', isPaid: true, annualQuota: 12, accrualFrequency: 'YEARLY', prorateOnJoining: true, carryForwardLimit: 0, allowHalfDay: true, minNoticeDays: 0, maxBackdatedDays: 7, maxConsecutiveDays: null },
  { code: 'EL', name: 'Earned leave', color: '#10b981', isPaid: true, annualQuota: 15, accrualFrequency: 'MONTHLY', prorateOnJoining: true, carryForwardLimit: 30, encashable: true, allowHalfDay: false, minNoticeDays: 7, maxBackdatedDays: 0, maxConsecutiveDays: null },
  { code: 'LOP', name: 'Leave without pay', color: '#64748b', isPaid: false, annualQuota: 0, accrualFrequency: 'NONE', unlimited: true, allowHalfDay: true, minNoticeDays: 0, maxBackdatedDays: 7, maxConsecutiveDays: null },
] as const;
