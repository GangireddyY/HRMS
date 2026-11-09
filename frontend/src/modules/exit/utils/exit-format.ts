import { INR_LOCALE } from '@/core/locale/locale';
import type { ClearanceDepartment, ClearanceStatus, DailyRateBasis, ExitLetterType, ExitReason, ExitStatus, ExitType, SettlementStatus } from '@contracts';

export const TYPE_LABELS: Record<ExitType, string> = { RESIGNATION: 'Resignation', TERMINATION: 'Termination', RETIREMENT: 'Retirement', CONTRACT_END: 'End of contract', DEATH: 'Death', OTHER: 'Other' };
export const REASON_LABELS: Record<ExitReason, string> = {
  BETTER_OPPORTUNITY: 'A better opportunity',
  COMPENSATION: 'Pay and benefits',
  CAREER_GROWTH: 'Career growth',
  RELOCATION: 'Relocation',
  HIGHER_STUDIES: 'Higher studies',
  PERSONAL: 'Personal reasons',
  HEALTH: 'Health',
  WORK_ENVIRONMENT: 'Work environment',
  MANAGER: 'Manager or team',
  PERFORMANCE: 'Performance',
  MISCONDUCT: 'Misconduct',
  REDUNDANCY: 'Redundancy',
  OTHER: 'Other',
};
/** Reasons an employee can give for resigning. */
export const RESIGNATION_REASONS: ExitReason[] = ['BETTER_OPPORTUNITY', 'COMPENSATION', 'CAREER_GROWTH', 'RELOCATION', 'HIGHER_STUDIES', 'PERSONAL', 'HEALTH', 'WORK_ENVIRONMENT', 'MANAGER', 'OTHER'];

export const STATUS_LABELS: Record<ExitStatus, string> = { SUBMITTED: 'Waiting for acceptance', APPROVED: 'Serving notice', COMPLETED: 'Exited', WITHDRAWN: 'Withdrawn', CANCELLED: 'Cancelled' };
export const statusTone: Record<ExitStatus, 'warning' | 'info' | 'neutral' | 'success'> = { SUBMITTED: 'warning', APPROVED: 'info', COMPLETED: 'neutral', WITHDRAWN: 'neutral', CANCELLED: 'neutral' };

export const DEPARTMENT_LABELS: Record<ClearanceDepartment, string> = { MANAGER: 'Manager', IT: 'IT', ADMIN: 'Admin', FINANCE: 'Finance', HR: 'HR' };
export const CLEARANCE_LABELS: Record<ClearanceStatus, string> = { PENDING: 'Pending', CLEARED: 'Cleared', NOT_APPLICABLE: 'Not applicable' };
export const clearanceTone: Record<ClearanceStatus, 'warning' | 'success' | 'neutral'> = { PENDING: 'warning', CLEARED: 'success', NOT_APPLICABLE: 'neutral' };

export const SETTLEMENT_LABELS: Record<SettlementStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', PAID: 'Paid' };
export const settlementTone: Record<SettlementStatus, 'neutral' | 'warning' | 'info' | 'success'> = { DRAFT: 'neutral', SUBMITTED: 'warning', APPROVED: 'info', PAID: 'success' };
export const BASIS_LABELS: Record<DailyRateBasis, string> = { BASIC_26: 'Monthly Basic ÷ 26', BASIC_30: 'Monthly Basic ÷ 30', GROSS_30: 'Monthly gross ÷ 30' };

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${n.toLocaleString(INR_LOCALE, { maximumFractionDigits: 2 })}`);
export const serviceLabel = (s: { years: number; months: number; days: number }) =>
  [s.years ? `${s.years} year${s.years === 1 ? '' : 's'}` : null, s.months ? `${s.months} month${s.months === 1 ? '' : 's'}` : null, `${s.days} day${s.days === 1 ? '' : 's'}`].filter(Boolean).join(', ');
export const LETTER_LABELS: Record<ExitLetterType, string> = { RELIEVING: 'Relieving letter', EXPERIENCE: 'Experience certificate' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "7 January 2019" — how dates are written on letters. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Whole days from today to an ISO date (negative when it is in the past). */
export function daysUntil(iso: string): number {
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(localIso(new Date()))) / 86_400_000);
}
/** "in 3 days", "today", "tomorrow", "2 days ago". */
export function relativeDays(iso: string): string {
  const d = daysUntil(iso);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** The HR exit workflow, for steppers: which steps are done and which one is next. */
export function exitSteps(e: { type: ExitType; status: ExitStatus; clearance: { total: number; done: number }; settlement: { status: SettlementStatus } | null }) {
  const accepted = e.status === 'APPROVED' || e.status === 'COMPLETED';
  const list = [
    { key: 'submitted', label: e.type === 'RESIGNATION' ? 'Resigned' : 'Notice given', done: true },
    { key: 'accepted', label: e.type === 'RESIGNATION' ? 'Accepted' : 'Confirmed', done: accepted },
    { key: 'clearance', label: 'Clearance', done: e.clearance.total > 0 && e.clearance.done === e.clearance.total },
    { key: 'settlement', label: 'Settlement', done: e.settlement?.status === 'PAID' },
    { key: 'exited', label: 'Exited', done: e.status === 'COMPLETED' },
  ];
  const at = list.findIndex((s) => !s.done);
  return list.map((s, i) => ({ ...s, state: (s.done ? 'done' : i === at ? 'current' : 'upcoming') as 'done' | 'current' | 'upcoming' }));
}
