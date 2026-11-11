import type { InvoiceStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type { BillingContact, BillingOverview, InvoiceRow, MyBilling, OrganizationBilling } from '../types';

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

const P = '/platform/billing';

export const platformBillingApi = {
  overview: () => http.get<BillingOverview>(P),
  invoices: (q: ListQuery & { status?: InvoiceStatus | 'OVERDUE'; organizationId?: string }) => http.page<InvoiceRow>(`${P}/invoices`, q),
  organization: (id: string) => http.get<OrganizationBilling>(`${P}/organizations/${id}`),
  updateSubscription: (id: string, body: Record<string, unknown>) => http.put<OrganizationBilling>(`${P}/organizations/${id}/subscription`, body),
  createInvoice: (id: string, body: { periodStart?: string; extraLines?: InvoiceLineInput[]; notes?: string }) => http.post<InvoiceRow>(`${P}/organizations/${id}/invoices`, body),
  updateInvoice: (id: string, body: { lines?: InvoiceLineInput[]; taxRatePct?: number; notes?: string | null }) => http.patch<InvoiceRow>(`${P}/invoices/${id}`, body),
  deleteInvoice: (id: string) => http.delete<void>(`${P}/invoices/${id}`),
  issue: (id: string) => http.post<InvoiceRow>(`${P}/invoices/${id}/issue`),
  recordPayment: (id: string, body: { amount: number; paidOn: string; method: string; reference?: string; note?: string }) => http.post<InvoiceRow>(`${P}/invoices/${id}/payments`, body),
  void: (id: string, reason: string) => http.post<InvoiceRow>(`${P}/invoices/${id}/void`, { reason }),
  pdf: (invoice: Pick<InvoiceRow, 'id' | 'number'>) => downloadFile(`${P}/invoices/${invoice.id}/pdf`, undefined, `${invoice.number ?? 'draft-invoice'}.pdf`),
};

export const billingApi = {
  mine: () => http.get<MyBilling>('/organizations/current/billing'),
  updateContact: (body: Partial<BillingContact>) => http.put<MyBilling>('/organizations/current/billing/contact', body),
  pdf: (invoice: Pick<InvoiceRow, 'id' | 'number'>) => downloadFile(`/organizations/current/billing/invoices/${invoice.id}/pdf`, undefined, `${invoice.number}.pdf`),
};
