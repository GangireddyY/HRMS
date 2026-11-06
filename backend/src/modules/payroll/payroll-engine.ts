import {
  EPS_MAX_AGE,
  EPS_RATE,
  ESI_EMPLOYEE_RATE,
  ESI_EMPLOYER_RATE,
  ESI_WAGE_LIMIT,
  PF_RATE,
  PF_WAGE_CEILING,
  type ComponentCalculation,
  type ProfessionalTaxState,
  type TaxRegime,
} from '../../contracts';
import { incomeTax, OLD_REGIME_CAPS, taxRules, type IncomeTax } from './tax-rules';

/** Pure payroll arithmetic (no database): salary structure breakdowns, monthly earnings, PF, ESI, professional tax and TDS. */

export type ComponentRole = 'BASIC' | 'HRA';

export interface StructureLine {
  componentId: string;
  code: string;
  name: string;
  role: ComponentRole | null;
  calculation: ComponentCalculation;
  /** Percentage or monthly amount; null for BALANCE. */
  value: number | null;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
}

export interface StatutoryOptions {
  pfEnabled: boolean;
  /** Employee is a PF member (false = opted out / excluded employee). */
  pfApplicable: boolean;
  /** Contribute on wages up to the ceiling only. */
  pfRestrictToCeiling: boolean;
  esiEnabled: boolean;
}

/** One earning in a salary snapshot (monthly amount at full attendance). */
export interface SalaryComponent {
  componentId: string;
  code: string;
  name: string;
  role: ComponentRole | null;
  monthly: number;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
}

export interface SalaryBreakdown {
  monthlyCtc: number;
  monthlyGross: number;
  components: SalaryComponent[];
  employerPf: number;
  employerEsi: number;
  annualCtc: number;
}

export class StructureError extends Error {}

const rupees = (n: number) => Math.round(n);

export function pfBase(pfWage: number, restrictToCeiling: boolean): number {
  return restrictToCeiling ? Math.min(pfWage, PF_WAGE_CEILING) : pfWage;
}

/**
 * Splits an annual CTC into monthly earnings. CTC = gross + employer PF + employer ESI; the BALANCE line absorbs what
 * is left once every other line and the employer contributions are worked out.
 */
export function salaryBreakdown(annualCtc: number, lines: StructureLine[], opts: StatutoryOptions): SalaryBreakdown {
  if (!(annualCtc > 0)) throw new StructureError('The annual CTC must be more than zero');
  const balance = lines.filter((l) => l.calculation === 'BALANCE');
  if (balance.length !== 1) throw new StructureError('The structure needs exactly one balancing component');
  const basicLine = lines.find((l) => l.role === 'BASIC');
  if (!basicLine) throw new StructureError('The structure needs a Basic component');
  if (basicLine.calculation === 'PERCENT_OF_BASIC' || basicLine.calculation === 'BALANCE') throw new StructureError('Basic must be a percentage of CTC or a fixed amount');

  const monthlyCtc = annualCtc / 12;
  const amountOf = (l: StructureLine, basic: number) =>
    l.calculation === 'PERCENT_OF_CTC' ? (monthlyCtc * (l.value ?? 0)) / 100 : l.calculation === 'PERCENT_OF_BASIC' ? (basic * (l.value ?? 0)) / 100 : (l.value ?? 0);
  const basic = rupees(amountOf(basicLine, 0));
  const fixed = lines
    .filter((l) => l.calculation !== 'BALANCE')
    .map((l) => ({ line: l, monthly: l === basicLine ? basic : rupees(amountOf(l, basic)) }));

  const pfWage = fixed.filter((f) => f.line.pfWage).reduce((n, f) => n + f.monthly, 0);
  const employerPf = opts.pfEnabled && opts.pfApplicable ? rupees(pfBase(pfWage, opts.pfRestrictToCeiling) * PF_RATE) : 0;
  const remaining = rupees(monthlyCtc) - employerPf;

  let gross = remaining;
  let employerEsi = 0;
  if (opts.esiEnabled) {
    let g = Math.floor(remaining / (1 + ESI_EMPLOYER_RATE));
    while (g + Math.ceil(g * ESI_EMPLOYER_RATE) > remaining) g--;
    if (g <= ESI_WAGE_LIMIT) {
      gross = g;
      employerEsi = Math.ceil(g * ESI_EMPLOYER_RATE);
    }
  }
  const fixedTotal = fixed.reduce((n, f) => n + f.monthly, 0);
  const rest = gross - fixedTotal;
  if (rest < 0) {
    throw new StructureError(`The CTC is too low for this structure: its fixed parts need ₹${(fixedTotal + employerPf + employerEsi - rupees(monthlyCtc)).toLocaleString('en-IN')} more per month`);
  }
  const amounts = new Map(fixed.map((f) => [f.line.componentId, f.monthly]));
  amounts.set(balance[0]!.componentId, rest);
  const components = lines.map((l) => ({
    componentId: l.componentId,
    code: l.code,
    name: l.name,
    role: l.role,
    monthly: amounts.get(l.componentId)!,
    taxable: l.taxable,
    pfWage: l.pfWage,
    esiWage: l.esiWage,
  }));
  return { monthlyCtc: gross + employerPf + employerEsi, monthlyGross: gross, components, employerPf, employerEsi, annualCtc };
}

// ---- Monthly earnings ---------------------------------------------------------------------------

export interface PayDay {
  date: string;
  /** Salary in force on the day; null = employed but no salary yet (or not employed). */
  salary: SalaryComponent[] | null;
  /** Loss-of-pay fraction for the day: 0, 0.5 or 1. */
  lop: number;
}

export interface EarnedComponent {
  componentId: string;
  code: string;
  name: string;
  role: ComponentRole | null;
  amount: number;
  /** Monthly amount at full attendance (latest salary in the month). */
  rate: number;
  taxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
}

/**
 * Earnings for the month, prorated per calendar day: each day pays 1/daysInMonth of the salary in force that day,
 * less its loss-of-pay share. `lopOverride` replaces the attendance-based LOP days (charged at the latest salary).
 */
export function earnedComponents(days: PayDay[], daysInMonth: number, lopOverride: number | null = null): EarnedComponent[] {
  const totals = new Map<string, EarnedComponent>();
  const salaried = days.filter((d) => d.salary);
  for (const d of salaried) {
    const pay = lopOverride === null ? 1 - d.lop : 1;
    for (const c of d.salary!) {
      const t = totals.get(c.componentId) ?? { componentId: c.componentId, code: c.code, name: c.name, role: c.role, amount: 0, rate: c.monthly, taxable: c.taxable, pfWage: c.pfWage, esiWage: c.esiWage };
      t.amount += (c.monthly * pay) / daysInMonth;
      Object.assign(t, { rate: c.monthly, name: c.name, taxable: c.taxable, pfWage: c.pfWage, esiWage: c.esiWage });
      totals.set(c.componentId, t);
    }
  }
  if (lopOverride !== null && lopOverride > 0 && salaried.length) {
    for (const c of salaried[salaried.length - 1]!.salary!) {
      const t = totals.get(c.componentId)!;
      t.amount = Math.max(0, t.amount - (c.monthly * lopOverride) / daysInMonth);
    }
  }
  return [...totals.values()].map((t) => ({ ...t, amount: rupees(t.amount) }));
}

// ---- Statutory contributions ---------------------------------------------------------------------

export interface PfContribution {
  pfWage: number;
  epsWage: number;
  edliWage: number;
  employee: number;
  employerEpf: number;
  employerEps: number;
}

export function pfContribution(pfWageEarned: number, opts: { restrictToCeiling: boolean; age: number | null }): PfContribution {
  const base = pfBase(pfWageEarned, opts.restrictToCeiling);
  const capped = Math.min(pfWageEarned, PF_WAGE_CEILING);
  const employer = rupees(base * PF_RATE);
  const eps = opts.age !== null && opts.age >= EPS_MAX_AGE ? 0 : Math.min(rupees(capped * EPS_RATE), employer);
  return { pfWage: base, epsWage: eps ? capped : 0, edliWage: capped, employee: rupees(base * PF_RATE), employerEpf: employer - eps, employerEps: eps };
}

/** ESI contributions are rounded up to the next rupee. */
export function esiContribution(esiWage: number): { employee: number; employer: number } {
  if (esiWage <= 0) return { employee: 0, employer: 0 };
  return { employee: Math.ceil(esiWage * ESI_EMPLOYEE_RATE - 1e-9), employer: Math.ceil(esiWage * ESI_EMPLOYER_RATE - 1e-9) };
}

/** Coverage is fixed per contribution period (April–September, October–March) by the gross rate at its start. */
export function esiCovered(opts: { enabled: boolean; grossRate: number; month: number; coveredEarlierInPeriod: boolean | null }): boolean {
  if (!opts.enabled) return false;
  const periodStart = opts.month === 4 || opts.month === 10;
  if (!periodStart && opts.coveredEarlierInPeriod !== null) return opts.coveredEarlierInPeriod;
  return opts.grossRate <= ESI_WAGE_LIMIT;
}

export function professionalTax(state: ProfessionalTaxState | null, gross: number, gender: string | null, month: number): number {
  return state && gross > 0 ? state.amount(gross, gender, month) : 0;
}

// ---- TDS (income tax deducted at source) -----------------------------------------------------------

export interface TaxDeclaration {
  regime: TaxRegime;
  rentPaidAnnual: number;
  metroCity: boolean;
  section80c: number;
  section80ccd1b: number;
  section80d: number;
  homeLoanInterest: number;
  previousEmployerIncome: number;
  previousEmployerTds: number;
}

export interface TaxFigures {
  taxable: number;
  basic: number;
  hra: number;
  employeePf: number;
  professionalTax: number;
}

export interface TdsInput {
  fy: number;
  /** Age at the end of the financial year (null = unknown, treated as below 60). */
  age: number | null;
  declaration: TaxDeclaration;
  /** Earlier payslips of this financial year (approved runs). */
  ytd: TaxFigures & { tds: number };
  current: TaxFigures;
  /** Full-month figures used to project the rest of the year. */
  recurring: TaxFigures;
  /** Months left in the financial year after this one while employed. */
  remainingMonths: number;
}

export interface TdsResult {
  regime: TaxRegime;
  rulesYear: number;
  projectedGross: number;
  hraExemption: number;
  standardDeduction: number;
  deductions: { section80c: number; section80ccd1b: number; section80d: number; homeLoanInterest: number; professionalTax: number };
  tax: IncomeTax;
  alreadyDeducted: number;
  remainingTax: number;
  monthsLeftIncludingThis: number;
  thisMonth: number;
}

/**
 * Projects the year's taxable salary (previous employer + this year so far + this month + the remaining months at the
 * current rate), works out the year's tax and spreads what is still due evenly over the months left.
 */
export function monthlyTds(input: TdsInput): TdsResult {
  const d = input.declaration;
  const months = input.remainingMonths;
  const project = (k: keyof TaxFigures) => input.ytd[k] + input.current[k] + input.recurring[k] * months;
  const projectedGross = d.previousEmployerIncome + project('taxable');
  const { rules, rulesYear } = taxRules(input.fy, d.regime);
  const age = input.age ?? 0;

  let hraExemption = 0;
  let deductions = { section80c: 0, section80ccd1b: 0, section80d: 0, homeLoanInterest: 0, professionalTax: 0 };
  if (d.regime === 'OLD') {
    const hra = project('hra');
    const basic = project('basic');
    if (hra > 0 && d.rentPaidAnnual > 0) hraExemption = Math.max(0, Math.min(hra, d.rentPaidAnnual - 0.1 * basic, (d.metroCity ? 0.5 : 0.4) * basic));
    deductions = {
      section80c: Math.min(OLD_REGIME_CAPS.section80c, d.section80c + project('employeePf')),
      section80ccd1b: Math.min(OLD_REGIME_CAPS.section80ccd1b, d.section80ccd1b),
      section80d: Math.min(OLD_REGIME_CAPS.section80d, d.section80d),
      homeLoanInterest: Math.min(OLD_REGIME_CAPS.homeLoanInterest, d.homeLoanInterest),
      professionalTax: Math.min(OLD_REGIME_CAPS.professionalTax, project('professionalTax')),
    };
  }
  const standardDeduction = Math.min(rules.standardDeduction, projectedGross);
  const taxable = projectedGross - hraExemption - standardDeduction - Object.values(deductions).reduce((n, v) => n + v, 0);
  const tax = incomeTax(taxable, d.regime, age, input.fy);
  const alreadyDeducted = d.previousEmployerTds + input.ytd.tds;
  const remainingTax = Math.max(0, tax.total - alreadyDeducted);
  const monthsLeftIncludingThis = months + 1;
  return {
    regime: d.regime,
    rulesYear,
    projectedGross: rupees(projectedGross),
    hraExemption: rupees(hraExemption),
    standardDeduction,
    deductions: Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, rupees(v)])) as TdsResult['deductions'],
    tax,
    alreadyDeducted,
    remainingTax,
    monthsLeftIncludingThis,
    thisMonth: input.current.taxable > 0 ? rupees(remainingTax / monthsLeftIncludingThis) : 0,
  };
}

/** Whole years of age on a date. */
export function ageOn(dateOfBirth: string | null, on: string): number | null {
  if (!dateOfBirth) return null;
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
