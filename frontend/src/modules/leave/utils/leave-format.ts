import type { AccrualFrequency, LeaveRequestStatus, LeaveSession, LedgerKind } from '@contracts';
import { formatDate } from '@/shared/utils/format';

export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const leaveStatusTone: Record<LeaveRequestStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };

export const ACCRUAL_LABELS: Record<AccrualFrequency, string> = { YEARLY: 'Yearly (full quota at the start of the year)', MONTHLY: 'Monthly (1/12 every month)', NONE: 'Granted by HR only' };
export const ACCRUAL_SHORT: Record<AccrualFrequency, string> = { YEARLY: 'Yearly', MONTHLY: 'Monthly', NONE: 'By HR' };

export const LEDGER_LABELS: Record<LedgerKind, string> = {
  ACCRUAL: 'Accrued',
  CARRY_FORWARD: 'Carried forward',
  LAPSE: 'Lapsed',
  GRANT: 'Granted',
  ADJUSTMENT: 'Adjusted',
  ENCASHMENT: 'Encashed',
  TAKEN: 'Leave taken',
  REVERSAL: 'Leave cancelled',
};

export const SESSION_LABELS: Record<LeaveSession, string> = { FULL: 'Full day', FIRST_HALF: 'First half (morning)', SECOND_HALF: 'Second half (afternoon)' };

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2.5 days", "1 day", "0.5 day". */
export function formatDays(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const v = Math.round(n * 100) / 100;
  return `${v} day${Math.abs(v) === 1 || Math.abs(v) === 0.5 ? '' : 's'}`;
}

/** "12 Nov 2026", "12 Nov 2026 (morning)", "12–14 Nov 2026". */
export function formatLeaveRange(r: { startDate: string; endDate: string; startSession: LeaveSession; endSession: LeaveSession }): string {
  const half = (s: LeaveSession) => (s === 'FIRST_HALF' ? ' (morning)' : s === 'SECOND_HALF' ? ' (afternoon)' : '');
  if (r.startDate === r.endDate) return `${formatDate(r.startDate)}${half(r.startSession)}`;
  return `${formatDate(r.startDate)}${r.startSession === 'SECOND_HALF' ? ' (afternoon)' : ''} – ${formatDate(r.endDate)}${r.endSession === 'FIRST_HALF' ? ' (morning)' : ''}`;
}

/** Today's date in the browser (YYYY-MM-DD). */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
