import type { BankFileFormat, BonusBasis, ExpensePolicyRule, LoanStatus, LoanType, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus } from '@contracts';
import { downloadFile, http, type ListQuery } from '@/core/http/http-client';
import type {
  Claim,
  ClaimUsage,
  ExpensePolicyView,
  ComponentInput,
  Loan,
  LoanDetail,
  MyLoans,
  MyPayslip,
  PayGroup,
  PayGroups,
  PayrollRun,
  PayrollRunDetail,
  PayrollSettings,
  PayslipDetail,
  PayslipSummary,
  SalaryBreakdown,
  SalaryComponentDef,
  SalaryHistory,
  SalaryInput,
  SalaryRevision,
  SalaryRevisionStatus,
  SalaryRow,
  SalarySaveResult,
  SalaryStructure,
  StructureInput,
  TaxDeclaration,
  TaxDeclarationInput,
} from '../types';

export const payrollApi = {
  settings: () => http.get<PayrollSettings>('/payroll/settings'),
  updateSettings: (body: Partial<Omit<PayrollSettings, 'organizationState' | 'organizationPtState' | 'organizationLwfState'>>) => http.put<PayrollSettings>('/payroll/settings', body),

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
  setSalary: (employeeId: string, body: SalaryInput) => http.post<SalarySaveResult>(`/payroll/employees/${employeeId}/salaries`, body),
  removeSalary: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/salaries/${id}`),
  salaryRevisions: (status: SalaryRevisionStatus | 'ALL' = 'PENDING') => http.get<SalaryRevision[]>('/payroll/salary-revisions', { status }),
  approveSalaryRevision: (id: string) => http.post<SalaryRevision>(`/payroll/salary-revisions/${id}/approve`),
  rejectSalaryRevision: (id: string, note: string) => http.post<SalaryRevision>(`/payroll/salary-revisions/${id}/reject`, { note }),
  cancelSalaryRevision: (id: string) => http.post<{ id: string }>(`/payroll/salary-revisions/${id}/cancel`),
  mySalary: () => http.get<SalaryHistory>('/payroll/me/salary'),

  myDeclaration: (fy?: number) => http.get<TaxDeclaration>('/payroll/me/tax-declaration', { fy }),
  saveMyDeclaration: (body: TaxDeclarationInput, fy?: number) => http.put<TaxDeclaration>(`/payroll/me/tax-declaration${fy ? `?fy=${fy}` : ''}`, body),

  runs: (q: ListQuery & { year?: number; status?: PayrollRunStatus }) => http.page<PayrollRun>('/payroll/runs', q),
  run: (id: string) => http.get<PayrollRunDetail>(`/payroll/runs/${id}`),
  createRun: (body: { year: number; month: number; payGroupId?: string | null; notes?: string | null }) => http.post<PayrollRunDetail>('/payroll/runs', body),
  addBonus: (runId: string, body: { label: string; category: 'BONUS' | 'INCENTIVE'; basis: BonusBasis; value: number; employeeIds?: string[]; taxable?: boolean }) =>
    http.post<{ added: number; total: number; skipped: { employee: string; reason: string }[]; held: number }>(`/payroll/runs/${runId}/bonuses`, body),
  payGroups: () => http.get<PayGroups>('/payroll/pay-groups'),
  createPayGroup: (body: { name: string; description?: string | null; legalEntityId?: string | null }) => http.post<PayGroup>('/payroll/pay-groups', body),
  updatePayGroup: (id: string, body: { name?: string; description?: string | null; isActive?: boolean; legalEntityId?: string | null }) => http.patch<PayGroup>(`/payroll/pay-groups/${id}`, body),
  removePayGroup: (id: string) => http.delete<{ deleted: boolean }>(`/payroll/pay-groups/${id}`),
  assignPayGroup: (employeeIds: string[], payGroupId: string | null) => http.put<PayGroups>('/payroll/pay-groups/members', { employeeIds, payGroupId }),
  downloadPayslipPdf: (id: string, fileName: string) => downloadFile(`/payroll/payslips/${id}/pdf`, undefined, fileName),
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
  downloadBankFile: (id: string, format: BankFileFormat = 'GENERIC') => downloadFile(`/payroll/runs/${id}/bank-file`, { format }, 'bank-transfer.csv'),
  downloadPfEcr: (id: string) => downloadFile(`/payroll/runs/${id}/pf-ecr`, undefined, 'pf-ecr.txt'),

  myPayslips: () => http.get<MyPayslip[]>('/payroll/me/payslips'),
  payslip: (id: string) => http.get<PayslipDetail>(`/payroll/payslips/${id}`),

  claims: (q: ListQuery & { view?: 'mine' | 'approve' | 'finance' | 'all'; status?: ReimbursementStatus }) => http.page<Claim>('/payroll/reimbursements', q),
  claim: (id: string) => http.get<Claim>(`/payroll/reimbursements/${id}`),
  claimUsage: (month: string) => http.get<ClaimUsage>('/payroll/me/reimbursements/usage', { month }),
  expensePolicy: () => http.get<ExpensePolicyView>('/payroll/expense-policy'),
  updateExpensePolicy: (body: { categories: ExpensePolicyRule[]; financeApprovalAbove: number | null }) => http.put<ExpensePolicyView>('/payroll/expense-policy', body),
  createClaim: (body: { category: ReimbursementCategory; title: string; expenseDate: string; amount: number; description?: string | null; currency?: string | null }, receipt: File | null) =>
    receipt
      ? http.upload<Claim>('/payroll/reimbursements', receipt, { fileName: receipt.name, fields: { ...body, amount: String(body.amount), description: body.description ?? '', currency: body.currency ?? '' } })
      : http.post<Claim>('/payroll/reimbursements', body),
  approveClaim: (id: string, note?: string | null) => http.post<Claim>(`/payroll/reimbursements/${id}/approve`, { note }),
  rejectClaim: (id: string, note: string) => http.post<Claim>(`/payroll/reimbursements/${id}/reject`, { note }),
  cancelClaim: (id: string) => http.post<Claim>(`/payroll/reimbursements/${id}/cancel`),
  downloadReceipt: (id: string, fileName: string) => downloadFile(`/payroll/reimbursements/${id}/receipt`, undefined, fileName),
};

type LoanRequest = { type: LoanType; amount: number; tenureMonths: number; purpose: string };

export const loansApi = {
  mine: () => http.get<MyLoans>('/payroll/me/loans'),
  request: (body: LoanRequest) => http.post<LoanDetail>('/payroll/me/loans', body),
  list: (q: ListQuery & { view?: 'approve' | 'all'; status?: LoanStatus | 'OPEN'; type?: LoanType }) => http.page<Loan>('/payroll/loans', q),
  raise: (body: LoanRequest & { employeeId: string }) => http.post<LoanDetail>('/payroll/loans', body),
  firstMonth: () => http.get<{ year: number; month: number }>('/payroll/loans/first-month'),
  get: (id: string) => http.get<LoanDetail>(`/payroll/loans/${id}`),
  approve: (id: string, body: { amount?: number; tenureMonths?: number; interestRate?: number; startYear: number; startMonth: number; note?: string | null }) => http.post<LoanDetail>(`/payroll/loans/${id}/approve`, body),
  reject: (id: string, note: string) => http.post<LoanDetail>(`/payroll/loans/${id}/reject`, { note }),
  cancel: (id: string) => http.post<LoanDetail>(`/payroll/loans/${id}/cancel`),
  disburse: (id: string, body: { disbursedOn: string; reference: string }) => http.post<LoanDetail>(`/payroll/loans/${id}/disburse`, body),
  defer: (id: string, body: { startYear: number; startMonth: number; note: string }) => http.post<LoanDetail>(`/payroll/loans/${id}/defer`, body),
  repay: (id: string, body: { amount: number; paidOn: string; note: string }) => http.post<LoanDetail>(`/payroll/loans/${id}/repayments`, body),
};
