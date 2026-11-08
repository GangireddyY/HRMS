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
