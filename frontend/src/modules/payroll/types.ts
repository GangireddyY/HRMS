import type { ComponentCalculation, LoanRepaymentSource, LoanStatus, LoanType, PayrollRunStatus, ReimbursementCategory, ReimbursementStatus, TaxRegime } from '@contracts';

export interface PayrollSettings {
  pfEnabled: boolean;
  pfRestrictToCeiling: boolean;
  esiEnabled: boolean;
  ptEnabled: boolean;
  ptState: string | null;
  lopFromAttendance: boolean;
  overtimeMultiplier: number;
  overtimeBasis: 'BASIC' | 'GROSS';
  pfEstablishmentCode: string | null;
  esiEmployerCode: string | null;
  tan: string | null;
  organizationState: string | null;
  organizationPtState: string | null;
}

export interface SalaryComponentDef {
  id: string;
  code: string;
  name: string;
  description: string | null;
  role: 'BASIC' | 'HRA' | null;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  isActive: boolean;
}

export type ComponentInput = Omit<SalaryComponentDef, 'id' | 'isActive'> & { isActive?: boolean };

export interface StructureLine {
  id?: string;
  componentId: string;
  component?: SalaryComponentDef | null;
  calculation: ComponentCalculation;
  value: number | null;
}

export interface SalaryStructure {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  inUse: boolean;
  lines: StructureLine[];
}

export interface StructureInput {
  name: string;
  description?: string | null;
  isActive?: boolean;
  lines: { componentId: string; calculation: ComponentCalculation; value: number | null }[];
}

export interface BreakdownComponent {
  componentId: string;
  code: string;
  name: string;
  role: 'BASIC' | 'HRA' | null;
  monthly: number;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
}

export interface SalaryBreakdown {
  monthlyCtc: number;
  monthlyGross: number;
  components: BreakdownComponent[];
  employerPf: number;
  employerEsi: number;
  annualCtc: number;
}

export interface EmployeeSalary {
  id: string;
  employeeId: string;
  structure: { id: string; name: string | null };
  annualCtc: number;
  effectiveFrom: string;
  pfApplicable: boolean;
  monthlyGross: number;
  employerPf: number;
  employerEsi: number;
  monthlyCtc: number;
  components: BreakdownComponent[];
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
  locked?: boolean;
}

export interface SalaryRow {
  employee: { id: string; name: string; employeeCode: string; department: string | null; designation: string | null; dateOfJoining: string };
  current: EmployeeSalary | null;
  upcoming: { effectiveFrom: string; annualCtc: number } | null;
}

export interface SalaryHistory {
  employee: { id: string; name: string; employeeCode: string; dateOfJoining: string; status: string } | null;
  lockedThrough: string | null;
  salaries: EmployeeSalary[];
}

export interface SalaryInput {
  structureId: string;
  annualCtc: number;
  effectiveFrom: string;
  pfApplicable?: boolean;
  reason?: string | null;
}

export interface TaxDeclaration {
  employee: { id: string; name: string; employeeCode: string };
  financialYear: number;
  regime: TaxRegime;
  rentPaidAnnual: number;
  metroCity: boolean;
  section80c: number;
  section80ccd1b: number;
  section80d: number;
  homeLoanInterest: number;
  previousEmployerIncome: number;
  previousEmployerTds: number;
  updatedAt: string | null;
}

export type TaxDeclarationInput = Omit<TaxDeclaration, 'employee' | 'financialYear' | 'updatedAt'>;

export interface PayrollRun {
  id: string;
  year: number;
  month: number;
  period: string;
  status: PayrollRunStatus;
  employeeCount: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  warningCount: number;
  calculatedAt: string | null;
  calculatedBy: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  paidAt: string | null;
  paidBy: string | null;
  paymentReference: string | null;
  createdAt: string;
}

export interface PayrollRunDetail extends PayrollRun {
  notes: string | null;
  summary: {
    earnings: PayslipLine[];
    deductions: PayslipLine[];
    employerContributions: PayslipLine[];
    held: number;
    blocking: number;
  };
  missingSalary: { id: string; employeeCode: string; name: string }[];
  attendance: { lopFromAttendance: boolean; monthClosed: boolean };
  permissions: { process: boolean; approve: boolean; pay: boolean; cancel: boolean };
}

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  rate?: number;
  taxable?: boolean;
}

export interface PayslipEmployee {
  name: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  location: string | null;
  dateOfJoining: string;
  exitDate: string | null;
  pan: string | null;
  uan: string | null;
  bank: { name: string | null; accountLast4: string; ifsc: string | null } | null;
}

export interface PayslipSummary {
  id: string;
  runId: string;
  employeeId: string;
  employee: PayslipEmployee;
  daysInMonth: number;
  employedDays: number;
  lopDays: number;
  lopOverride: number | null;
  payableDays: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  excluded: boolean;
  excludeReason: string | null;
  warnings: string[];
}

export interface TaxWorking {
  regime: TaxRegime;
  rulesYear: number;
  projectedGross: number;
  hraExemption: number;
  standardDeduction: number;
  deductions: { section80c: number; section80ccd1b: number; section80d: number; homeLoanInterest: number; professionalTax: number };
  tax: { taxableIncome: number; slabTax: number; rebate: number; surcharge: number; cess: number; total: number };
  alreadyDeducted: number;
  remainingTax: number;
  monthsLeftIncludingThis: number;
  thisMonth: number;
}

export interface PayslipDetail extends PayslipSummary {
  period: string;
  year: number;
  month: number;
  runStatus: PayrollRunStatus;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  statutory: { salaryGross: number; pfApplicable: boolean; pfWage: number; esiCovered: boolean; esiWage: number; ptState: string | null };
  tax: TaxWorking | null;
  organization: { name: string; address: string | null; logoUrl: string | null } | null;
  adjustments: { id: string; kind: 'EARNING' | 'DEDUCTION'; label: string; amount: number; taxable: boolean }[];
}

export interface MyPayslip {
  id: string;
  year: number;
  month: number;
  period: string;
  status: PayrollRunStatus;
  paidAt: string | null;
  gross: number;
  totalDeductions: number;
  netPay: number;
}

export interface Claim {
  id: string;
  employee: { id: string; name: string; employeeCode: string; department: string | null } | null;
  category: ReimbursementCategory;
  title: string;
  expenseDate: string;
  amount: number;
  description: string | null;
  receipt: { fileName: string; contentType: string; size: number } | null;
  status: ReimbursementStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  payroll: { id: string; period: string; status: PayrollRunStatus } | null;
  createdAt: string;
  permissions: { review: boolean; cancel: boolean };
}

export interface Instalment {
  principal: number;
  interest: number;
  amount: number;
}

export interface Loan {
  id: string;
  reference: string;
  type: LoanType;
  employee: { id: string; name: string; employeeCode: string; department: string | null } | null;
  purpose: string;
  principal: number;
  interestRate: number;
  tenureMonths: number;
  emi: number | null;
  start: { year: number; month: number; label: string } | null;
  status: LoanStatus;
  disbursedOn: string | null;
  repaid: number;
  interestPaid: number;
  outstanding: number;
  instalmentsPaid: number;
  nextInstalment: Instalment | null;
  createdAt: string;
}

export interface LoanDetail extends Loan {
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  raisedBy: string | null;
  disbursedBy: string | null;
  disbursementReference: string | null;
  closedAt: string | null;
  repayments: { id: string; source: LoanRepaymentSource; paidOn: string; period: string | null; principal: number; interest: number; note: string | null }[];
  schedule: (Instalment & { year: number; month: number; balance: number })[];
  permissions: { approve: boolean; reject: boolean; cancel: boolean; disburse: boolean; defer: boolean; repay: boolean };
}

export interface MyLoans {
  loans: (Loan & { permissions: { cancel: boolean } })[];
  canRequest: boolean;
}
