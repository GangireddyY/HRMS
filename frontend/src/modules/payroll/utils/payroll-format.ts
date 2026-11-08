import { INR_LOCALE } from '@/core/locale/locale';
import type { ComponentCalculation, LoanRepaymentSource, LoanStatus, LoanType, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus, TaxRegime } from '@contracts';

export const RUN_STATUS_LABELS: Record<PayrollRunStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'Awaiting approval', APPROVED: 'Approved', PAID: 'Paid', CANCELLED: 'Cancelled' };
export const runTone: Record<PayrollRunStatus, 'neutral' | 'warning' | 'info' | 'success'> = { DRAFT: 'neutral', SUBMITTED: 'warning', APPROVED: 'info', PAID: 'success', CANCELLED: 'neutral' };

export const CALCULATION_LABELS: Record<ComponentCalculation, string> = {
  PERCENT_OF_CTC: '% of CTC',
  PERCENT_OF_BASIC: '% of Basic',
  FIXED: 'Fixed per month',
  BALANCE: 'Balance (rest of the gross)',
};

export const REGIME_LABELS: Record<TaxRegime, string> = { NEW: 'New regime', OLD: 'Old regime' };

export const CLAIM_CATEGORY_LABELS: Record<ReimbursementCategory, string> = {
  TRAVEL: 'Travel',
  FOOD: 'Food & meals',
  INTERNET_PHONE: 'Internet & phone',
  MEDICAL: 'Medical',
  RELOCATION: 'Relocation',
  OFFICE_SUPPLIES: 'Office supplies',
  OTHER: 'Other',
};
export const CLAIM_STATUS_LABELS: Record<ReimbursementStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Withdrawn', PAID: 'Paid' };
export const claimTone: Record<ReimbursementStatus, 'warning' | 'info' | 'danger' | 'neutral' | 'success'> = { PENDING: 'warning', APPROVED: 'info', REJECTED: 'danger', CANCELLED: 'neutral', PAID: 'success' };

export const LOAN_TYPE_LABELS: Record<LoanType, string> = { LOAN: 'Loan', ADVANCE: 'Salary advance' };
export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = { REQUESTED: 'Waiting for approval', APPROVED: 'Approved', ACTIVE: 'Repaying', CLOSED: 'Repaid', REJECTED: 'Not approved', CANCELLED: 'Cancelled' };
export const loanTone: Record<LoanStatus, 'warning' | 'info' | 'brand' | 'success' | 'danger' | 'neutral'> = { REQUESTED: 'warning', APPROVED: 'info', ACTIVE: 'brand', CLOSED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
export const REPAYMENT_SOURCE_LABELS: Record<LoanRepaymentSource, string> = { PAYROLL: 'Salary deduction', MANUAL: 'Paid directly', SETTLEMENT: 'Full & final settlement' };
/** Monthly instalment on the reducing balance, rounded up to the rupee (same rule as the server). */
export function loanEmi(principal: number, annualRate: number, months: number): number {
  if (!principal || !months) return 0;
  if (annualRate <= 0) return Math.ceil(principal / months);
  const r = annualRate / 1200;
  const f = (1 + r) ** months;
  return Math.ceil((principal * r * f) / (f - 1));
}

const inr = new Intl.NumberFormat(INR_LOCALE, { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat(INR_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "₹1,23,456" (Indian digit grouping). */
export function rupees(n: number | null | undefined, decimals = false): string {
  if (n === null || n === undefined) return '—';
  return `${n < 0 ? '−' : ''}₹${(decimals ? inr2 : inr).format(Math.abs(n))}`;
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Warnings starting with "!" block submission. */
export const isBlocking = (warning: string) => warning.startsWith('!');
export const warningText = (warning: string) => warning.replace(/^!\s*/, '');

/** "Basic 50% of CTC", "HRA 50% of Basic", "₹1,600 fixed". */
export function lineRule(calculation: ComponentCalculation, value: number | null): string {
  if (calculation === 'BALANCE') return 'Balance';
  if (calculation === 'FIXED') return `${rupees(value)} / month`;
  return `${value}% of ${calculation === 'PERCENT_OF_CTC' ? 'CTC' : 'Basic'}`;
}
