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
      const base = s === 'FEMALE' ? slab(g, [[25000, 0]], 200) : slab(g, [[7500, 0], [10000, 175]], 200);
      return base === 200 && m === 2 ? 300 : base;
    },
  },
  { code: 'TG', name: 'Telangana', amount: (g) => slab(g, [[15000, 0], [20000, 150]], 200) },
  { code: 'AP', name: 'Andhra Pradesh', amount: (g) => slab(g, [[15000, 0], [20000, 150]], 200) },
  { code: 'WB', name: 'West Bengal', amount: (g) => slab(g, [[10000, 0], [15000, 110], [25000, 130], [40000, 150]], 200) },
  { code: 'GJ', name: 'Gujarat', amount: (g) => (g >= 12000 ? 200 : 0) },
];

/** Matches a state code or name ("KA", "Karnataka"); null when the state levies no supported professional tax. */
export function professionalTaxState(state: string | null | undefined): ProfessionalTaxState | null {
  if (!state) return null;
  const s = state.trim().toLowerCase();
  return PROFESSIONAL_TAX_STATES.find((p) => p.code.toLowerCase() === s || p.name.toLowerCase() === s) ?? null;
}

/** Financial year (April–March) containing the month; returned as its starting year (2026 = FY 2026-27). */
export const financialYearOf = (year: number, month: number) => (month >= 4 ? year : year - 1);
export const financialYearLabel = (fy: number) => `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
