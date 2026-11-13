import { BUILT_IN_CONTRIBUTION_RATES, contributionRatesProblem, taxRuleSetProblem, type TaxRuleSet } from '../../contracts';
import { esiContribution, esiCovered, pfContribution, salaryBreakdown } from './payroll-engine';
import { BUILT_IN_TAX_RULES, builtInRules, incomeTax, slabsFor } from './tax-rules';

const RAISED = { ...BUILT_IN_CONTRIBUTION_RATES, pfWageCeiling: 21_000, esiWageLimit: 25_000, esiEmployeeRate: 0.01 };
const copy = (): TaxRuleSet => JSON.parse(JSON.stringify(BUILT_IN_TAX_RULES[2026])) as TaxRuleSet;

describe('statutory rates as data', () => {
  it('uses the contribution rates it is given, the built-in ones otherwise', () => {
    expect(pfContribution(25_000, { restrictToCeiling: true, age: 30 }).employee).toBe(1_800);
    expect(pfContribution(25_000, { restrictToCeiling: true, age: 30, rates: RAISED })).toMatchObject({ pfWage: 21_000, employee: 2_520, employerEps: 1_749, edliWage: 21_000 });
    expect(esiCovered({ enabled: true, grossRate: 23_000, month: 4, coveredEarlierInPeriod: null })).toBe(false);
    expect(esiCovered({ enabled: true, grossRate: 23_000, month: 4, coveredEarlierInPeriod: null, rates: RAISED })).toBe(true);
    expect(esiContribution(20_000, RAISED)).toEqual({ employee: 200, employer: 650 });
    const lines = [
      { componentId: 'b', code: 'BASIC', name: 'Basic', role: 'BASIC' as const, calculation: 'PERCENT_OF_CTC' as const, value: 50, taxable: true, pfWage: true, esiWage: true },
      { componentId: 's', code: 'SPECIAL', name: 'Special', role: null, calculation: 'BALANCE' as const, value: null, taxable: true, pfWage: false, esiWage: true },
    ];
    const opts = { pfEnabled: true, pfApplicable: true, pfRestrictToCeiling: true, esiEnabled: false };
    expect(salaryBreakdown(600_000, lines, opts).employerPf).toBe(1_800);
    expect(salaryBreakdown(600_000, lines, { ...opts, rates: RAISED }).employerPf).toBe(2_520);
  });

  it('applies a year of tax rules entered as data', () => {
    const set = copy();
    set.NEW.standardDeduction = 100_000;
    set.NEW.slabs = [{ upTo: 500_000, rate: 0 }, { upTo: 1_000_000, rate: 0.1 }, { upTo: null, rate: 0.2 }];
    set.NEW.rebateIncomeLimit = 0;
    set.NEW.rebateMax = 0;
    set.cess = 0.05;
    expect(incomeTax(15_00_000, 'NEW', 30, 2027, { year: 2027, set })).toMatchObject({ slabTax: 150_000, cess: 7_500, total: 157_500 });
    // Without entered rules, later years use the last built-in year.
    expect(builtInRules(2030).year).toBe(2026);
    expect(incomeTax(15_00_000, 'NEW', 30, 2030).total).toBe(incomeTax(15_00_000, 'NEW', 30, 2026).total);
  });

  it('picks old-regime slabs by age', () => {
    const old = BUILT_IN_TAX_RULES[2026]!.OLD;
    expect(slabsFor(old, 45)[0]!.upTo).toBe(250_000);
    expect(slabsFor(old, 65)[0]!.upTo).toBe(300_000);
    expect(slabsFor(old, 85)[0]!.upTo).toBe(500_000);
    expect(slabsFor(BUILT_IN_TAX_RULES[2026]!.NEW, 85)[0]!.upTo).toBe(400_000);
  });

  it('refuses rules that would miscalculate', () => {
    expect(contributionRatesProblem(BUILT_IN_CONTRIBUTION_RATES)).toBeNull();
    expect(contributionRatesProblem({ ...BUILT_IN_CONTRIBUTION_RATES, pfRate: 12 })).toMatch(/between 0 and 50%/);
    expect(contributionRatesProblem({ ...BUILT_IN_CONTRIBUTION_RATES, epsRate: 0.2 })).toMatch(/EPS/);
    expect(contributionRatesProblem({ ...BUILT_IN_CONTRIBUTION_RATES, pfWageCeiling: 0 })).toMatch(/ceilings/);

    expect(taxRuleSetProblem(copy())).toBeNull();
    const open = copy();
    open.NEW.slabs = [{ upTo: 400_000, rate: 0 }, { upTo: 800_000, rate: 0.05 }];
    expect(taxRuleSetProblem(open)).toMatch(/last slab must have no upper limit/);
    const falling = copy();
    falling.OLD.slabs = [{ upTo: 500_000, rate: 0 }, { upTo: 300_000, rate: 0.05 }, { upTo: null, rate: 0.3 }];
    expect(taxRuleSetProblem(falling)).toMatch(/Old regime slabs: upper limits must rise/);
    const percent = copy();
    percent.NEW.slabs[1]!.rate = 5;
    expect(taxRuleSetProblem(percent)).toMatch(/between 0 and 60%/);
    expect(taxRuleSetProblem({ ...copy(), cess: 4 })).toMatch(/cess/);
  });
});
