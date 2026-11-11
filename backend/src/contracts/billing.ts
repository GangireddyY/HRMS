/** Billing is manual: the platform issues invoices and records payments it receives. */
export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'CASH', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface BillTo {
  name: string;
  email: string | null;
  address: string | null;
  taxId: string | null;
}

export const INVOICE_MAX_LINES = 20;
