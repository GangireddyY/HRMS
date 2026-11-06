import type { TaxRegime } from '../../contracts';

/** Income-tax rules for salaried individuals (residents), per financial year (starting year) and regime. */
interface Slab {
  /** Upper bound of the slab (inclusive); null = no upper bound. */
  upTo: number | null;
  rate: number;
}

interface RegimeRules {
  standardDeduction: number;
  slabs(age: number): Slab[];
  /** Section 87A: full rebate of the tax up to `rebateMax` when taxable income is at or below `rebateIncomeLimit`. */
  rebateIncomeLimit: number;
  rebateMax: number;
  /** New regime: just above the limit, tax can't exceed the income above the limit. */
  rebateMarginalRelief: boolean;
  surcharge: { above: number; rate: number }[];
}

const L = 100_000;
const CR = 10_000_000;

const NEW_REGIME_2025: RegimeRules = {
  standardDeduction: 75_000,
  slabs: () => [
    { upTo: 4 * L, rate: 0 },
    { upTo: 8 * L, rate: 0.05 },
    { upTo: 12 * L, rate: 0.1 },
    { upTo: 16 * L, rate: 0.15 },
    { upTo: 20 * L, rate: 0.2 },
    { upTo: 24 * L, rate: 0.25 },
    { upTo: null, rate: 0.3 },
  ],
  rebateIncomeLimit: 12 * L,
  rebateMax: 60_000,
  rebateMarginalRelief: true,
  surcharge: [
    { above: 50 * L, rate: 0.1 },
    { above: 1 * CR, rate: 0.15 },
    { above: 2 * CR, rate: 0.25 },
  ],
};

const OLD_REGIME: RegimeRules = {
  standardDeduction: 50_000,
  slabs: (age) => {
    const exempt = age >= 80 ? 5 * L : age >= 60 ? 3 * L : 2.5 * L;
    return [
      { upTo: exempt, rate: 0 },
      ...(exempt < 5 * L ? [{ upTo: 5 * L, rate: 0.05 }] : []),
      { upTo: 10 * L, rate: 0.2 },
      { upTo: null, rate: 0.3 },
    ];
  },
  rebateIncomeLimit: 5 * L,
  rebateMax: 12_500,
  rebateMarginalRelief: false,
  surcharge: [
    { above: 50 * L, rate: 0.1 },
    { above: 1 * CR, rate: 0.15 },
    { above: 2 * CR, rate: 0.25 },
    { above: 5 * CR, rate: 0.37 },
  ],
};

/**
 * Finance Act 2025 rates (FY 2025-26). FY 2026-27 onwards is under the Income-tax Act, 2025, which carried the same
 * slabs, standard deduction and rebate forward; update this table whenever a Finance Act changes them.
 */
const RULES: Record<number, Record<TaxRegime, RegimeRules>> = {
  2025: { NEW: NEW_REGIME_2025, OLD: OLD_REGIME },
  2026: { NEW: NEW_REGIME_2025, OLD: OLD_REGIME },
};
const FIRST_FY = Math.min(...Object.keys(RULES).map(Number));
const LAST_FY = Math.max(...Object.keys(RULES).map(Number));

export const HEALTH_EDUCATION_CESS = 0.04;

/** Section 80C (incl. employee PF), 80CCD(1B), 80D and 24(b) caps under the old regime; professional tax under 16(iii). */
export const OLD_REGIME_CAPS = { section80c: 150_000, section80ccd1b: 50_000, section80d: 100_000, homeLoanInterest: 200_000, professionalTax: 2_500 };

export function taxRules(fy: number, regime: TaxRegime): { rules: RegimeRules; rulesYear: number } {
  if (fy < FIRST_FY) throw new Error(`Income-tax rules before FY ${FIRST_FY}-${(FIRST_FY + 1) % 100} are not available`);
  const rulesYear = Math.min(fy, LAST_FY);
  return { rules: RULES[rulesYear]![regime], rulesYear };
}

function slabTax(income: number, slabs: Slab[]): number {
  let tax = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (income > lower) tax += (Math.min(income, upper) - lower) * s.rate;
    lower = upper;
  }
  return tax;
}

export interface IncomeTax {
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  total: number;
}

/** Tax on taxable income (after deductions), with the 87A rebate, surcharge with marginal relief, and cess. */
export function incomeTax(taxableIncomeRaw: number, regime: TaxRegime, age: number, fy: number): IncomeTax {
  const { rules } = taxRules(fy, regime);
  // Section 288A: taxable income is rounded to the nearest multiple of ten rupees.
  const income = Math.max(0, Math.round(taxableIncomeRaw / 10) * 10);
  const slabs = rules.slabs(age);
  const base = slabTax(income, slabs);

  let afterRebate = base;
  if (income <= rules.rebateIncomeLimit) afterRebate = Math.max(0, base - rules.rebateMax);
  else if (rules.rebateMarginalRelief) afterRebate = Math.min(base, income - rules.rebateIncomeLimit);
  const rebate = base - afterRebate;

  let withSurcharge = afterRebate;
  const band = [...rules.surcharge].reverse().find((s) => income > s.above);
  if (band) {
    withSurcharge = afterRebate * (1 + band.rate);
    // Marginal relief: the extra tax can't exceed the income above the threshold.
    const lowerRate = [...rules.surcharge].reverse().find((s) => band.above > s.above)?.rate ?? 0;
    const atThreshold = slabTax(band.above, slabs) * (1 + lowerRate);
    withSurcharge = Math.min(withSurcharge, atThreshold + (income - band.above));
  }
  const surcharge = withSurcharge - afterRebate;
  const cess = withSurcharge * HEALTH_EDUCATION_CESS;
  const r = (n: number) => Math.round(n);
  return { taxableIncome: income, slabTax: r(base), rebate: r(rebate), surcharge: r(surcharge), cess: r(cess), total: r(withSurcharge + cess) };
}
