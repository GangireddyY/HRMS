import type { ComponentCalculation, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus, TaxRegime } from '@contracts';

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

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
