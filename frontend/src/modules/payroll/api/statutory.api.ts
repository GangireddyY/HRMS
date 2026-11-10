import type { TaxProofSection, TaxProofStatus } from '@contracts';
import { downloadFile, http, openDocument, type ListQuery } from '@/core/http/http-client';

export interface TaxProof {
  id: string;
  financialYear: number;
  section: TaxProofSection;
  sectionLabel: string;
  description: string;
  amount: number;
  acceptedAmount: number | null;
  status: TaxProofStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  file: { name: string; contentType: string; size: number };
  createdAt: string;
  employee?: { id: string; name: string; employeeCode: string } | null;
}

export interface TaxProofOverview {
  employee: { id: string; name: string; employeeCode: string };
  financialYear: number;
  regime: 'OLD' | 'NEW';
  sections: { section: TaxProofSection; label: string; declared: number; submitted: number; accepted: number }[];
  proofs: TaxProof[];
}

export interface Form16Summary {
  financialYear: number;
  regime: 'OLD' | 'NEW';
  grossSalary: number;
  taxableIncome: number;
  totalTax: number;
  tdsDeducted: number;
  previousEmployerTds: number;
  quarters: { quarter: string; amountPaid: number; tds: number }[];
}

export interface StatutorySummary {
  pf: { employee: number; employer: number; members: number };
  esi: { employee: number; employer: number; members: number };
  professionalTax: { state: string; total: number }[];
  labourWelfare: { employee: { state: string; total: number }[]; employer: number };
  tds: number;
}

export const statutoryApi = {
  myProofs: (fy?: number) => http.get<TaxProofOverview>('/payroll/me/tax-proofs', { fy }),
  uploadProof: (body: { fy?: number; section: TaxProofSection; description: string; amount: number }, file: File) =>
    http.upload<TaxProof>('/payroll/me/tax-proofs', file, { fileName: file.name, fields: { fy: body.fy ? String(body.fy) : undefined, section: body.section, description: body.description, amount: String(body.amount) } }),
  removeProof: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/me/tax-proofs/${id}`),
  downloadProof: (id: string, fileName: string) => downloadFile(`/payroll/tax-proofs/${id}/file`, undefined, fileName),
  openForm12bb: (fy?: number) => openDocument('/payroll/me/form12bb', { fy }),
  myForm16: (fy?: number) => http.get<Form16Summary | null>('/payroll/me/form16', { fy }),
  openForm16: (fy?: number) => openDocument('/payroll/me/form16/document', { fy }),

  proofs: (q: ListQuery & { fy?: number; status?: TaxProofStatus }) => http.page<TaxProof>('/payroll/tax-proofs', q),
  acceptProof: (id: string, body: { amount?: number; note?: string | null }) => http.post<TaxProof>(`/payroll/tax-proofs/${id}/accept`, body),
  rejectProof: (id: string, note: string) => http.post<TaxProof>(`/payroll/tax-proofs/${id}/reject`, { note }),
  openEmployeeForm16: (employeeId: string, fy: number) => openDocument(`/payroll/employees/${employeeId}/form16/document`, { fy }),
  download24q: (fy: number, quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4') => downloadFile('/payroll/statutory/24q', { fy, quarter }, `24q-${fy}-${quarter}.csv`),

  summary: (runId: string) => http.get<StatutorySummary>(`/payroll/runs/${runId}/statutory-summary`),
  downloadEsiReturn: (runId: string) => downloadFile(`/payroll/runs/${runId}/esi-return`, undefined, 'esi-return.csv'),
  downloadStateLevies: (runId: string) => downloadFile(`/payroll/runs/${runId}/state-levies`, undefined, 'state-levies.csv'),
};
