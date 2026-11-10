/** Payroll: salary structures, statutory rules (India), payroll runs, payslips and reimbursements. */

export const COMPONENT_KINDS = ['EARNING', 'DEDUCTION'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/**
 * How a structure line is worked out from the annual CTC (all amounts monthly):
 *  PERCENT_OF_CTC   value % of the monthly CTC
 *  PERCENT_OF_BASIC value % of the BASIC component
 *  FIXED            value per month
 *  BALANCE          what is left of the gross after every other line (exactly one per structure)
 */
export const COMPONENT_CALCULATIONS = ['PERCENT_OF_CTC', 'PERCENT_OF_BASIC', 'FIXED', 'BALANCE'] as const;
export type ComponentCalculation = (typeof COMPONENT_CALCULATIONS)[number];

export const TAX_REGIMES = ['NEW', 'OLD'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

/** DRAFT (being calculated / edited) → SUBMITTED → APPROVED (payslips published) → PAID; DRAFT or SUBMITTED → CANCELLED. */
export const PAYROLL_RUN_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const REIMBURSEMENT_CATEGORIES = ['TRAVEL', 'FOOD', 'INTERNET_PHONE', 'MEDICAL', 'RELOCATION', 'OFFICE_SUPPLIES', 'OTHER'] as const;
export type ReimbursementCategory = (typeof REIMBURSEMENT_CATEGORIES)[number];

/** PENDING → APPROVED → PAID (with the payroll run it was included in); PENDING → REJECTED / CANCELLED. */
export const REIMBURSEMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'PAID'] as const;
export type ReimbursementStatus = (typeof REIMBURSEMENT_STATUSES)[number];
/** A pending claim waits on the manager, then (above the finance threshold) on finance. */
export const CLAIM_APPROVAL_STEPS = ['MANAGER', 'FINANCE'] as const;
export type ClaimApprovalStep = (typeof CLAIM_APPROVAL_STEPS)[number];

/** One category's expense policy; amounts in the organization's currency, null = no limit. */
export interface ExpensePolicyRule {
  category: ReimbursementCategory;
  allowed: boolean;
  perClaimLimit: number | null;
  monthlyLimit: number | null;
  /** 0 = a receipt is always required; null = never required. */
  receiptRequiredAbove: number | null;
}

export const RECEIPT_CONTENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/** Statutory rates (Employees' Provident Funds and ESI Acts). */
export const PF_RATE = 0.12;
export const EPS_RATE = 0.0833;
/** Monthly PF wage ceiling; EPS is always on wages up to the ceiling, PF optionally. */
export const PF_WAGE_CEILING = 15000;
/** Members aged 58 or more stop contributing to the pension scheme; the whole employer share goes to EPF. */
export const EPS_MAX_AGE = 58;
export const ESI_EMPLOYEE_RATE = 0.0075;
export const ESI_EMPLOYER_RATE = 0.0325;
/** Employees whose monthly gross is at or below this at the start of a contribution period are covered for the period. */
export const ESI_WAGE_LIMIT = 21000;

/** Professional tax (state levy on salaries), monthly, on the gross earned in the month. */
export interface ProfessionalTaxState {
  code: string;
  name: string;
  /** Monthly amount for a gross; February may differ so the yearly total matches the law. */
  amount(gross: number, gender: string | null, month: number): number;
}

const slab = (gross: number, rows: [upTo: number, amount: number][], above: number) => rows.find(([upTo]) => gross <= upTo)?.[1] ?? above;

export const PROFESSIONAL_TAX_STATES: readonly ProfessionalTaxState[] = [
  { code: 'KA', name: 'Karnataka', amount: (g, _s, m) => (g >= 25000 ? (m === 2 ? 300 : 200) : 0) },
  {
    code: 'MH',
    name: 'Maharashtra',
    amount: (g, s, m) => {
      const base =
        s === 'FEMALE'
          ? slab(g, [[25000, 0]], 200)
          : slab(
              g,
              [
                [7500, 0],
                [10000, 175],
              ],
              200,
            );
      return base === 200 && m === 2 ? 300 : base;
    },
  },
  {
    code: 'TG',
    name: 'Telangana',
    amount: (g) =>
      slab(
        g,
        [
          [15000, 0],
          [20000, 150],
        ],
        200,
      ),
  },
  {
    code: 'AP',
    name: 'Andhra Pradesh',
    amount: (g) =>
      slab(
        g,
        [
          [15000, 0],
          [20000, 150],
        ],
        200,
      ),
  },
  {
    code: 'WB',
    name: 'West Bengal',
    amount: (g) =>
      slab(
        g,
        [
          [10000, 0],
          [15000, 110],
          [25000, 130],
          [40000, 150],
        ],
        200,
      ),
  },
  { code: 'GJ', name: 'Gujarat', amount: (g) => (g >= 12000 ? 200 : 0) },
];

/** Matches a state code or name ("KA", "Karnataka"); null when the state levies no supported professional tax. */
export function professionalTaxState(state: string | null | undefined): ProfessionalTaxState | null {
  if (!state) return null;
  const s = state.trim().toLowerCase();
  return PROFESSIONAL_TAX_STATES.find((p) => p.code.toLowerCase() === s || p.name.toLowerCase() === s) ?? null;
}

/**
 * Labour welfare fund: a small state contribution from employee and employer, deducted in the months the state
 * prescribes (null = every month). Published rates; check them against the state's latest notification.
 */
export interface LabourWelfareState {
  code: string;
  name: string;
  months: number[] | null;
  contribution(gross: number): { employee: number; employer: number };
}

const fixed =
  (employee: number, employer: number, minGross = 0) =>
  (gross: number) =>
    gross > minGross ? { employee, employer } : { employee: 0, employer: 0 };
const HALF_YEARLY = [6, 12];

export const LABOUR_WELFARE_STATES: readonly LabourWelfareState[] = [
  { code: 'MH', name: 'Maharashtra', months: HALF_YEARLY, contribution: fixed(25, 75, 3000) },
  { code: 'KA', name: 'Karnataka', months: [12], contribution: fixed(50, 100) },
  { code: 'TN', name: 'Tamil Nadu', months: [12], contribution: fixed(20, 40) },
  { code: 'GJ', name: 'Gujarat', months: HALF_YEARLY, contribution: fixed(6, 12) },
  { code: 'WB', name: 'West Bengal', months: HALF_YEARLY, contribution: fixed(3, 15) },
  { code: 'AP', name: 'Andhra Pradesh', months: [12], contribution: fixed(30, 70) },
  { code: 'TG', name: 'Telangana', months: [12], contribution: fixed(2, 5) },
  { code: 'KL', name: 'Kerala', months: null, contribution: fixed(50, 50) },
  { code: 'DL', name: 'Delhi', months: HALF_YEARLY, contribution: fixed(0.75, 2.25) },
  {
    code: 'HR',
    name: 'Haryana',
    months: null,
    contribution: (gross) => {
      const employee = Math.min(34, Math.round(gross * 0.002 * 100) / 100);
      return { employee, employer: employee * 2 };
    },
  },
  { code: 'PB', name: 'Punjab', months: null, contribution: fixed(5, 20) },
  { code: 'CH', name: 'Chandigarh', months: null, contribution: fixed(5, 20) },
  { code: 'MP', name: 'Madhya Pradesh', months: HALF_YEARLY, contribution: fixed(10, 30) },
  { code: 'GA', name: 'Goa', months: HALF_YEARLY, contribution: fixed(60, 180) },
  { code: 'OR', name: 'Odisha', months: HALF_YEARLY, contribution: fixed(20, 40) },
];

export function labourWelfareState(state: string | null | undefined): LabourWelfareState | null {
  if (!state) return null;
  const s = state.trim().toLowerCase();
  return LABOUR_WELFARE_STATES.find((p) => p.code.toLowerCase() === s || p.name.toLowerCase() === s) ?? null;
}

/** Investment and rent proofs (Form 12BB) employees submit for the deductions they declared. */
export const TAX_PROOF_SECTIONS = ['80C', '80CCD1B', '80D', 'HRA', 'HOME_LOAN'] as const;
export type TaxProofSection = (typeof TAX_PROOF_SECTIONS)[number];
export const TAX_PROOF_SECTION_LABELS: Record<TaxProofSection, string> = {
  '80C': 'Section 80C (PPF, ELSS, life insurance, tuition fees…)',
  '80CCD1B': 'Section 80CCD(1B) (NPS)',
  '80D': 'Section 80D (health insurance)',
  HRA: 'House rent (rent receipts, landlord PAN above ₹1 lakh a year)',
  HOME_LOAN: 'Home loan interest (section 24(b))',
};
export const TAX_PROOF_STATUSES = ['SUBMITTED', 'ACCEPTED', 'REJECTED'] as const;
export type TaxProofStatus = (typeof TAX_PROOF_STATUSES)[number];
export const TAX_PROOF_MAX_BYTES = 5 * 1024 * 1024;

/** One-off payments and deductions in a run; ARREARS is for manual arrears (revisions are paid automatically). */
export const ADJUSTMENT_CATEGORIES = ['BONUS', 'INCENTIVE', 'ARREARS', 'OTHER'] as const;
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number];
export const ADJUSTMENT_CATEGORY_LABELS: Record<AdjustmentCategory, string> = { BONUS: 'Bonus', INCENTIVE: 'Incentive', ARREARS: 'Arrears', OTHER: 'Other' };

/** How a bonus payout is worked out for each employee. */
export const BONUS_BASES = ['FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_GROSS', 'STATUTORY'] as const;
export type BonusBasis = (typeof BONUS_BASES)[number];
/**
 * Payment of Bonus Act, 1965: employees earning up to ₹21,000 a month (Basic + DA) are eligible; the bonus is worked
 * out on the higher of ₹7,000 or the minimum wage (we use the ₹7,000 floor) at 8.33%–20% of the wages for the year.
 */
export const STATUTORY_BONUS = { eligibleUpTo: 21_000, calculationCeiling: 7_000, minRate: 8.33, maxRate: 20 } as const;

/** Salary transfer file layouts. Bank templates change; check the bank's current bulk-upload format before first use. */
export const BANK_FILE_FORMATS = ['GENERIC', 'HDFC', 'ICICI', 'SBI', 'AXIS'] as const;
export type BankFileFormat = (typeof BANK_FILE_FORMATS)[number];
export const BANK_FILE_FORMAT_LABELS: Record<BankFileFormat, string> = { GENERIC: 'Standard CSV', HDFC: 'HDFC Bank bulk upload', ICICI: 'ICICI Bank bulk payment', SBI: 'SBI CMP bulk', AXIS: 'Axis Bank bulk' };

export const PAYSLIP_PDF_PASSWORDS = ['NONE', 'DOB'] as const;
export type PayslipPdfPassword = (typeof PAYSLIP_PDF_PASSWORDS)[number];

/** Back-dated salary revisions (paid as arrears) can reach this many months before the last processed payroll. */
export const ARREARS_MAX_MONTHS = 12;

/** Loans (with optional interest) and salary advances (interest-free, repaid within a year), recovered from salary. */
export const LOAN_TYPES = ['LOAN', 'ADVANCE'] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
/** Reference prefixes: LOAN-0001, ADV-0001… numbered separately per organization. */
export const LOAN_PREFIX: Record<LoanType, string> = { LOAN: 'LOAN', ADVANCE: 'ADV' };
/**
 * REQUESTED → APPROVED (terms set by someone other than the employee or whoever raised it) → ACTIVE (disbursed;
 * instalments deducted by payroll) → CLOSED (fully repaid); REQUESTED → REJECTED; REQUESTED / APPROVED → CANCELLED.
 */
export const LOAN_STATUSES = ['REQUESTED', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED', 'CANCELLED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export const OPEN_LOAN_STATUSES: readonly LoanStatus[] = ['REQUESTED', 'APPROVED', 'ACTIVE'];
/** How a repayment was made: deducted by a payroll run, paid back directly, or recovered in the full & final settlement. */
export const LOAN_REPAYMENT_SOURCES = ['PAYROLL', 'MANUAL', 'SETTLEMENT'] as const;
export type LoanRepaymentSource = (typeof LOAN_REPAYMENT_SOURCES)[number];
export const LOAN_MAX_PRINCIPAL = 10_000_000;
export const LOAN_MAX_TENURE_MONTHS = 60;
export const ADVANCE_MAX_TENURE_MONTHS = 12;
export const LOAN_MAX_INTEREST_RATE = 30;

/** Financial year (April–March) containing the month; returned as its starting year (2026 = FY 2026-27). */
export const financialYearOf = (year: number, month: number) => (month >= 4 ? year : year - 1);
export const financialYearLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
