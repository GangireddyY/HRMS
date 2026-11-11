import type { BillingCycle, BillTo, InvoiceLine, InvoiceStatus, OrganizationStatus, PaymentMethod, SubscriptionStatus } from '@contracts';

export interface BillingTerms {
  plan: { id: string; name: string; code: string; maxUsers: number | null; monthlyPrice: number | null } | null;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currency: string;
  seats: { used: number; limit: number | null; override: number | null };
  pricePerMonth: number | null;
  priceOverride: number | null;
  discountPct: number;
  taxRatePct: number;
  paymentTermsDays: number;
  trialEndsOn: string | null;
  nextPeriodStart: string | null;
  monthlyAmount: number | null;
  cycleAmount: number | null;
}

export interface BillingContact {
  billingName: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingTaxId: string | null;
}

export interface SubscriptionDetail extends BillingTerms {
  contact: BillingContact;
  billTo: BillTo;
  notes?: string | null;
  cancelledAt?: string | null;
}

export interface InvoicePaymentRow {
  id: string;
  amount: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface InvoiceRow {
  id: string;
  organizationId: string;
  number: string | null;
  status: InvoiceStatus;
  overdue: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  lines: InvoiceLine[];
  subtotal: number;
  discount: number;
  taxRatePct: number;
  tax: number;
  total: number;
  amountPaid: number;
  balance: number;
  billTo: BillTo | null;
  notes: string | null;
  issuedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  payments: InvoicePaymentRow[];
  createdAt: string;
  organization?: { id: string; name: string; slug: string } | null;
}

export interface BillingOverviewRow extends BillingTerms {
  organization: { id: string; name: string; slug: string; status: OrganizationStatus };
  balanceDue: number;
  overdue: number;
  pastDue: boolean;
}

export interface BillingOverview {
  totals: { currency: string; mrr: number; outstanding: number; overdue: number; collectedThisMonth: number; organizations: number }[];
  organizations: BillingOverviewRow[];
}

export interface OrganizationBilling {
  organization: { id: string; name: string; slug: string; status: OrganizationStatus };
  subscription: SubscriptionDetail;
  balanceDue: number;
  overdue: number;
  invoices: InvoiceRow[];
}

export interface MyBilling {
  subscription: SubscriptionDetail;
  balanceDue: number;
  overdue: number;
  invoices: InvoiceRow[];
}
