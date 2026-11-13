import type { TaxRegime, TaxRegimeRules, TaxRuleSet, TaxSlab } from '../../contracts';

/**
 * Income-tax rules for salaried individuals (residents), per financial year (starting year) and regime. The built-in
 * years are below; platform administrators add later years (Platform → Statutory rates) as data in the same shape.
 */
const L = 100_000;
const CR = 10_000_000;

const NEW_REGIME_2025: TaxRegimeRules = {
  standardDeduction: 75_000,
  slabs: [
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

const OLD_REGIME: TaxRegimeRules = {
  standardDeduction: 50_000,
  slabs: [
    { upTo: 2.5 * L, rate: 0 },
    { upTo: 5 * L, rate: 0.05 },
    { upTo: 10 * L, rate: 0.2 },
    { upTo: null, rate: 0.3 },
  ],
  slabsSenior: [
    { upTo: 3 * L, rate: 0 },
    { upTo: 5 * L, rate: 0.05 },
    { upTo: 10 * L, rate: 0.2 },
    { upTo: null, rate: 0.3 },
  ],
  slabsSuperSenior: [
    { upTo: 5 * L, rate: 0 },
    { upTo: 10 * L, rate: 0.2 },
    { upTo: null, rate: 0.3 },
  ],
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

export const HEALTH_EDUCATION_CESS = 0.04;

/**
 * Finance Act 2025 rates (FY 2025-26). FY 2026-27 onwards is under the Income-tax Act, 2025, which carried the same
 * slabs, standard deduction and rebate forward. Later Finance Acts are entered as data, not code.
 */
export const BUILT_IN_TAX_RULES: Readonly<Record<number, TaxRuleSet>> = {
  2025: { NEW: NEW_REGIME_2025, OLD: OLD_REGIME, cess: HEALTH_EDUCATION_CESS },
  2026: { NEW: NEW_REGIME_2025, OLD: OLD_REGIME, cess: HEALTH_EDUCATION_CESS },
};
export const FIRST_TAX_FY = Math.min(...Object.keys(BUILT_IN_TAX_RULES).map(Number));
const LAST_BUILT_IN_FY = Math.max(...Object.keys(BUILT_IN_TAX_RULES).map(Number));

/** A year's rules as used for a calculation: which year they are, and the rules themselves. */
export interface YearRules {
  year: number;
  set: TaxRuleSet;
}

/** Section 80C (incl. employee PF), 80CCD(1B), 80D and 24(b) caps under the old regime; professional tax under 16(iii). */
export const OLD_REGIME_CAPS = { section80c: 150_000, section80ccd1b: 50_000, section80d: 100_000, homeLoanInterest: 200_000, professionalTax: 2_500 };

/** The built-in rules for a financial year (later years use the last built-in year until rules are entered for them). */
export function builtInRules(fy: number): YearRules {
  if (fy < FIRST_TAX_FY) throw new Error(`Income-tax rules before FY ${FIRST_TAX_FY}-${(FIRST_TAX_FY + 1) % 100} are not available`);
  const year = Math.min(fy, LAST_BUILT_IN_FY);
  return { year, set: BUILT_IN_TAX_RULES[year]! };
}

export function taxRules(fy: number, regime: TaxRegime, rules: YearRules = builtInRules(fy)): { rules: TaxRegimeRules; rulesYear: number; cess: number } {
  return { rules: rules.set[regime], rulesYear: rules.year, cess: rules.set.cess };
}

/** The slabs for a person's age (60+ and 80+ have their own old-regime slabs). */
export function slabsFor(r: TaxRegimeRules, age: number): TaxSlab[] {
  if (age >= 80 && r.slabsSuperSenior?.length) return r.slabsSuperSenior;
  if (age >= 60 && r.slabsSenior?.length) return r.slabsSenior;
  return r.slabs;
}

function slabTax(income: number, slabs: TaxSlab[]): number {
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
export function incomeTax(taxableIncomeRaw: number, regime: TaxRegime, age: number, fy: number, yearRules?: YearRules): IncomeTax {
  const { rules, cess: cessRate } = taxRules(fy, regime, yearRules);
  // Section 288A: taxable income is rounded to the nearest multiple of ten rupees.
  const income = Math.max(0, Math.round(taxableIncomeRaw / 10) * 10);
  const slabs = slabsFor(rules, age);
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
  const cess = withSurcharge * cessRate;
  const r = (n: number) => Math.round(n);
  return { taxableIncome: income, slabTax: r(base), rebate: r(rebate), surcharge: r(surcharge), cess: r(cess), total: r(withSurcharge + cess) };
}
