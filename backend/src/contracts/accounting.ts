/**
 * Accounting ledgers a payroll run posts to (Tally export). Each slot has a default ledger name; organizations
 * rename them to match their chart of accounts, and can send individual earning components to their own ledgers.
 */
export const LEDGER_SLOTS = [
  'SALARY_EXPENSE',
  'REIMBURSEMENT',
  'SALARY_PAYABLE',
  'PF_EXPENSE',
  'PF_PAYABLE',
  'ESI_EXPENSE',
  'ESI_PAYABLE',
  'LWF_EXPENSE',
  'LWF_PAYABLE',
  'PT_PAYABLE',
  'TDS_PAYABLE',
  'LOANS',
  'BENEFITS',
  'OTHER_DEDUCTIONS',
] as const;
export type LedgerSlot = (typeof LEDGER_SLOTS)[number];

/** Tally ledger group a slot's ledger is created under (ledger masters export). */
export type LedgerGroup = 'Indirect Expenses' | 'Current Liabilities' | 'Duties & Taxes' | 'Loans & Advances (Asset)';

export const LEDGER_SLOT_INFO: Record<LedgerSlot, { label: string; help: string; default: string; group: LedgerGroup; side: 'DEBIT' | 'CREDIT' }> = {
  SALARY_EXPENSE: { label: 'Salaries and wages', help: 'Every earning unless the component has its own ledger', default: 'Salaries and Wages', group: 'Indirect Expenses', side: 'DEBIT' },
  REIMBURSEMENT: { label: 'Reimbursements', help: 'Expense claims paid with salary', default: 'Staff Reimbursements', group: 'Indirect Expenses', side: 'DEBIT' },
  SALARY_PAYABLE: { label: 'Net salary payable', help: 'Take-home pay, cleared when the bank transfer is posted', default: 'Salary Payable', group: 'Current Liabilities', side: 'CREDIT' },
  PF_EXPENSE: { label: 'Employer PF and pension', help: 'Employer EPF and EPS', default: 'Employer Contribution to PF', group: 'Indirect Expenses', side: 'DEBIT' },
  PF_PAYABLE: { label: 'PF payable', help: 'Employee and employer PF, paid to EPFO', default: 'PF Payable', group: 'Duties & Taxes', side: 'CREDIT' },
  ESI_EXPENSE: { label: 'Employer ESI', help: 'Employer ESI contribution', default: 'Employer Contribution to ESI', group: 'Indirect Expenses', side: 'DEBIT' },
  ESI_PAYABLE: { label: 'ESI payable', help: 'Employee and employer ESI, paid to ESIC', default: 'ESI Payable', group: 'Duties & Taxes', side: 'CREDIT' },
  LWF_EXPENSE: { label: 'Employer labour welfare fund', help: 'Employer LWF contribution', default: 'Employer Contribution to LWF', group: 'Indirect Expenses', side: 'DEBIT' },
  LWF_PAYABLE: { label: 'LWF payable', help: 'Employee and employer LWF', default: 'Labour Welfare Fund Payable', group: 'Duties & Taxes', side: 'CREDIT' },
  PT_PAYABLE: { label: 'Professional tax payable', help: 'Deducted professional tax', default: 'Professional Tax Payable', group: 'Duties & Taxes', side: 'CREDIT' },
  TDS_PAYABLE: { label: 'TDS on salary payable', help: 'Income tax deducted (section 192)', default: 'TDS on Salary Payable', group: 'Duties & Taxes', side: 'CREDIT' },
  LOANS: { label: 'Loans and advances', help: 'Loan and salary advance recoveries', default: 'Loans and Advances to Employees', group: 'Loans & Advances (Asset)', side: 'CREDIT' },
  BENEFITS: { label: 'Benefit deductions', help: 'Employee share of benefit plans', default: 'Benefit Deductions Payable', group: 'Current Liabilities', side: 'CREDIT' },
  OTHER_DEDUCTIONS: { label: 'Other deductions', help: 'One-off deductions added to a run', default: 'Other Salary Deductions', group: 'Current Liabilities', side: 'CREDIT' },
};

/** Tally ledger and cost-centre names: up to 100 characters, no characters Tally rejects in names. */
export const LEDGER_NAME_PATTERN = /^[^<>"\\]{1,100}$/;

export interface AccountingSettingsView {
  /** Company name exactly as in Tally; null = the company open in Tally when importing. */
  tallyCompany: string | null;
  voucherType: string;
  /** Split expense lines by department as Tally cost centres. */
  costCentres: boolean;
  costCategory: string;
  ledgers: Record<LedgerSlot, string>;
  /** Earning component code → its own expense ledger. */
  earningLedgers: Record<string, string>;
}

export interface JournalLine {
  ledger: string;
  debit: number;
  credit: number;
  /** Cost-centre split of a debit line (when cost centres are on). */
  costCentres: { name: string; amount: number }[];
}

export interface PayrollJournal {
  runId: string;
  period: string;
  date: string;
  currency: string;
  narration: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  payslips: number;
}
