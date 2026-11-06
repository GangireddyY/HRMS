import type { PayrollRunStatus, ReimbursementCategory, ReimbursementStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type {
  Claim,
  ComponentInput,
  EmployeeSalary,
  MyPayslip,
  PayrollRun,
  PayrollRunDetail,
  PayrollSettings,
  PayslipDetail,
  PayslipSummary,
  SalaryBreakdown,
  SalaryComponentDef,
  SalaryHistory,
  SalaryInput,
  SalaryRow,
  SalaryStructure,
  StructureInput,
  TaxDeclaration,
  TaxDeclarationInput,
} from '../types';

export const payrollApi = {
  settings: () => http.get<PayrollSettings>('/payroll/settings'),
  updateSettings: (body: Partial<Omit<PayrollSettings, 'organizationState' | 'organizationPtState'>>) => http.put<PayrollSettings>('/payroll/settings', body),

  components: () => http.get<SalaryComponentDef[]>('/payroll/components'),
  createComponent: (body: ComponentInput) => http.post<SalaryComponentDef>('/payroll/components', body),
  updateComponent: (id: string, body: Partial<ComponentInput>) => http.patch<SalaryComponentDef>(`/payroll/components/${id}`, body),
  removeComponent: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/components/${id}`),

  structures: () => http.get<SalaryStructure[]>('/payroll/structures'),
  createStructure: (body: StructureInput) => http.post<SalaryStructure>('/payroll/structures', body),
  updateStructure: (id: string, body: Partial<StructureInput>) => http.patch<SalaryStructure>(`/payroll/structures/${id}`, body),
  removeStructure: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/structures/${id}`),
  recommended: () => http.post<{ components: SalaryComponentDef[]; structures: SalaryStructure[] }>('/payroll/structures/recommended'),

  preview: (body: { structureId: string; annualCtc: number; pfApplicable?: boolean }) => http.post<SalaryBreakdown>('/payroll/salaries/preview', body),
  salaries: (q: ListQuery & { departmentId?: string; missing?: boolean }) => http.page<SalaryRow>('/payroll/salaries', q),
  salaryHistory: (employeeId: string) => http.get<SalaryHistory>(`/payroll/employees/${employeeId}/salaries`),
  setSalary: (employeeId: string, body: SalaryInput) => http.post<EmployeeSalary>(`/payroll/employees/${employeeId}/salaries`, body),
  removeSalary: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/salaries/${id}`),
  mySalary: () => http.get<SalaryHistory>('/payroll/me/salary'),

  myDeclaration: (fy?: number) => http.get<TaxDeclaration>('/payroll/me/tax-declaration', { fy }),
  saveMyDeclaration: (body: TaxDeclarationInput, fy?: number) => http.put<TaxDeclaration>(`/payroll/me/tax-declaration${fy ? `?fy=${fy}` : ''}`, body),

  runs: (q: ListQuery & { year?: number; status?: PayrollRunStatus }) => http.page<PayrollRun>('/payroll/runs', q),
  run: (id: string) => http.get<PayrollRunDetail>(`/payroll/runs/${id}`),
  createRun: (body: { year: number; month: number; notes?: string | null }) => http.post<PayrollRunDetail>('/payroll/runs', body),
  calculate: (id: string) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/calculate`),
  submit: (id: string) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/submit`),
  approve: (id: string, note?: string | null) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/approve`, { note }),
  reject: (id: string, note: string) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/reject`, { note }),
  pay: (id: string, paymentReference: string) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/pay`, { paymentReference }),
  cancel: (id: string) => http.post<PayrollRunDetail>(`/payroll/runs/${id}/cancel`),
  runPayslips: (id: string, q: ListQuery & { filter?: 'warnings' | 'held' }) => http.page<PayslipSummary>(`/payroll/runs/${id}/payslips`, q),
  updatePayslip: (runId: string, payslipId: string, body: { lopOverride?: number | null; excluded?: boolean; excludeReason?: string | null }) =>
    http.patch<PayslipDetail>(`/payroll/runs/${runId}/payslips/${payslipId}`, body),
  addAdjustment: (runId: string, body: { employeeId: string; kind: 'EARNING' | 'DEDUCTION'; label: string; amount: number; taxable?: boolean }) =>
    http.post<PayslipDetail>(`/payroll/runs/${runId}/adjustments`, body),
  removeAdjustment: (runId: string, adjustmentId: string) => http.delete<PayslipDetail | null>(`/payroll/runs/${runId}/adjustments/${adjustmentId}`),
  downloadRegister: (id: string) => downloadFile(`/payroll/runs/${id}/register`, undefined, 'payroll-register.csv'),
  downloadBankFile: (id: string) => downloadFile(`/payroll/runs/${id}/bank-file`, undefined, 'bank-transfer.csv'),
  downloadPfEcr: (id: string) => downloadFile(`/payroll/runs/${id}/pf-ecr`, undefined, 'pf-ecr.txt'),

  myPayslips: () => http.get<MyPayslip[]>('/payroll/me/payslips'),
  payslip: (id: string) => http.get<PayslipDetail>(`/payroll/payslips/${id}`),

  claims: (q: ListQuery & { view?: 'mine' | 'approve' | 'all'; status?: ReimbursementStatus }) => http.page<Claim>('/payroll/reimbursements', q),
  createClaim: (body: { category: ReimbursementCategory; title: string; expenseDate: string; amount: number; description?: string | null }, receipt: File | null) =>
    receipt
      ? http.upload<Claim>('/payroll/reimbursements', receipt, { fileName: receipt.name, fields: { ...body, amount: String(body.amount), description: body.description ?? '' } })
      : http.post<Claim>('/payroll/reimbursements', body),
  approveClaim: (id: string, note?: string | null) => http.post<Claim>(`/payroll/reimbursements/${id}/approve`, { note }),
  rejectClaim: (id: string, note: string) => http.post<Claim>(`/payroll/reimbursements/${id}/reject`, { note }),
  cancelClaim: (id: string) => http.post<Claim>(`/payroll/reimbursements/${id}/cancel`),
  downloadReceipt: (id: string, fileName: string) => downloadFile(`/payroll/reimbursements/${id}/receipt`, undefined, fileName),
};
