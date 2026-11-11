import type { BillingCycle, InvoiceStatus, PaymentMethod, SubscriptionStatus } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import type { InvoiceRow } from '../types';

/** Amounts on invoices, to the paisa. */
export function money(amount: number | null | undefined, currency = 'INR'): string {
  if (amount === null || amount === undefined) return 'Custom';
  return new Intl.NumberFormat(appLocale(), { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export const CYCLE_LABELS: Record<BillingCycle, string> = { MONTHLY: 'Monthly', QUARTERLY: 'Quarterly', ANNUAL: 'Yearly' };
export const CYCLE_UNIT: Record<BillingCycle, string> = { MONTHLY: 'month', QUARTERLY: 'quarter', ANNUAL: 'year' };
export const METHOD_LABELS: Record<PaymentMethod, string> = { BANK_TRANSFER: 'Bank transfer', UPI: 'UPI', CHEQUE: 'Cheque', CARD: 'Card', CASH: 'Cash', OTHER: 'Other' };
export const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = { TRIAL: 'Trial', ACTIVE: 'Active', CANCELLED: 'Cancelled' };
export const SUBSCRIPTION_TONES: Record<SubscriptionStatus, 'info' | 'success' | 'neutral'> = { TRIAL: 'info', ACTIVE: 'success', CANCELLED: 'neutral' };

type Tone = 'neutral' | 'info' | 'success' | 'danger' | 'warning';
/** Issued invoices past their due date read as overdue. */
export function invoiceState(i: Pick<InvoiceRow, 'status' | 'overdue' | 'amountPaid'>): { label: string; tone: Tone } {
  if (i.status === 'ISSUED' && i.overdue) return { label: 'Overdue', tone: 'danger' };
  if (i.status === 'ISSUED' && i.amountPaid > 0) return { label: 'Part paid', tone: 'warning' };
  const map: Record<InvoiceStatus, { label: string; tone: Tone }> = { DRAFT: { label: 'Draft', tone: 'neutral' }, ISSUED: { label: 'Awaiting payment', tone: 'info' }, PAID: { label: 'Paid', tone: 'success' }, VOID: { label: 'Void', tone: 'neutral' } };
  return map[i.status];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "Nov 2026" or "Oct 2026 – Dec 2026". */
export function periodLabel(start: string | null, end: string | null): string {
  if (!start) return '—';
  if (!end || start.slice(0, 7) === end.slice(0, 7)) return month(start);
  return `${month(start)} – ${month(end)}`;
}
