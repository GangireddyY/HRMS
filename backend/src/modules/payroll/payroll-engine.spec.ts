import { labourWelfareState, professionalTaxState } from '../../contracts';
import { proofsApply } from './payroll-period';
import {
  ageOn,
  earnedComponents,
  esiContribution,
  esiCovered,
  labourWelfareFund,
  monthlyTds,
  pfContribution,
  professionalTax,
  salaryBreakdown,
  StructureError,
  type SalaryComponent,
  type StructureLine,
  type TaxDeclaration,
} from './payroll-engine';
import { incomeTax } from './tax-rules';

const line = (code: string, calculation: StructureLine['calculation'], value: number | null, extra: Partial<StructureLine> = {}): StructureLine => ({
  componentId: code,
  code,
  name: code,
  role: null,
  calculation,
  value,
  taxable: true,
  pfWage: false,
  esiWage: true,
  ...extra,
});
const STANDARD = [line('BASIC', 'PERCENT_OF_CTC', 50, { role: 'BASIC', pfWage: true }), line('HRA', 'PERCENT_OF_BASIC', 50, { role: 'HRA' }), line('SPECIAL', 'BALANCE', null)];
const STATUTORY = { pfEnabled: true, pfApplicable: true, pfRestrictToCeiling: true, esiEnabled: true };
const amount = (b: { components: { code: string; monthly: number }[] }, code: string) => b.components.find((c) => c.code === code)!.monthly;

describe('income tax', () => {
  it('applies the new-regime slabs, the 87A rebate and its marginal relief', () => {
    expect(incomeTax(12_00_000, 'NEW', 30, 2026).total).toBe(0);
    // Slab tax 61,500 is limited to the 10,000 earned above ₹12 lakh, plus cess.
    expect(incomeTax(12_10_000, 'NEW', 30, 2026)).toMatchObject({ slabTax: 61_500, rebate: 51_500, total: 10_400 });
    expect(incomeTax(12_75_000, 'NEW', 30, 2026)).toMatchObject({ slabTax: 71_250, rebate: 0, total: 74_100 });
    expect(incomeTax(20_00_000, 'NEW', 30, 2026).total).toBe(2_08_000);
  });

  it('applies the old-regime slabs by age and the ₹12,500 rebate', () => {
    expect(incomeTax(5_00_000, 'OLD', 30, 2026).total).toBe(0);
    expect(incomeTax(10_00_000, 'OLD', 30, 2026).total).toBe(1_17_000);
    // Senior citizens: first ₹3 lakh exempt; super seniors: ₹5 lakh.
    expect(incomeTax(10_00_000, 'OLD', 65, 2026).slabTax).toBe(1_10_000);
    expect(incomeTax(10_00_000, 'OLD', 82, 2026).slabTax).toBe(1_00_000);
  });

  it('adds surcharge with marginal relief above ₹50 lakh', () => {
    expect(incomeTax(60_00_000, 'NEW', 30, 2026)).toMatchObject({ slabTax: 13_80_000, surcharge: 1_38_000, total: 15_78_720 });
    // Just above the threshold the surcharge is capped at the income above ₹50 lakh.
    expect(incomeTax(50_10_000, 'NEW', 30, 2026)).toMatchObject({ slabTax: 10_83_000, surcharge: 7_000, total: 11_33_600 });
  });

  it('refuses years without rules', () => {
    expect(() => incomeTax(5_00_000, 'NEW', 30, 2020)).toThrow(/not available/);
  });
});

describe('salary breakdown', () => {
  it('splits a CTC into basic, HRA and the balance after employer PF', () => {
    const b = salaryBreakdown(6_00_000, STANDARD, STATUTORY);
    expect(b).toMatchObject({ monthlyGross: 48_200, employerPf: 1_800, employerEsi: 0, monthlyCtc: 50_000 });
    expect([amount(b, 'BASIC'), amount(b, 'HRA'), amount(b, 'SPECIAL')]).toEqual([25_000, 12_500, 10_700]);
  });

  it('includes employer ESI when the gross is within the ESI limit', () => {
    const b = salaryBreakdown(2_40_000, STANDARD, STATUTORY);
    expect(b).toMatchObject({ employerPf: 1_200, monthlyGross: 18_208, employerEsi: 592, monthlyCtc: 20_000 });
    expect(amount(b, 'SPECIAL')).toBe(3_208);
  });

  it('skips PF for employees outside PF and contributes on full wages when not restricted', () => {
    expect(salaryBreakdown(6_00_000, STANDARD, { ...STATUTORY, pfApplicable: false }).employerPf).toBe(0);
    expect(salaryBreakdown(6_00_000, STANDARD, { ...STATUTORY, pfRestrictToCeiling: false }).employerPf).toBe(3_000);
  });

  it('rejects structures that cannot fit the CTC', () => {
    const lines = [...STANDARD, line('LTA', 'FIXED', 20_000)];
    expect(() => salaryBreakdown(3_00_000, lines, STATUTORY)).toThrow(StructureError);
    expect(() => salaryBreakdown(6_00_000, STANDARD.slice(0, 2), STATUTORY)).toThrow(/balancing/);
  });
});

describe('monthly earnings', () => {
  const salary = (basic: number, hra: number): SalaryComponent[] => [
    { componentId: 'B', code: 'BASIC', name: 'Basic', role: 'BASIC', monthly: basic, taxable: true, pfWage: true, esiWage: true },
    { componentId: 'H', code: 'HRA', name: 'HRA', role: 'HRA', monthly: hra, taxable: true, pfWage: false, esiWage: true },
  ];
  const month = (n: number, fn: (day: number) => { salary: SalaryComponent[] | null; lop?: number }) =>
    Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, lop: 0, ...fn(i + 1) }));

  it('prorates by calendar day, loss of pay and mid-month revisions', () => {
    const full = earnedComponents(
      month(30, () => ({ salary: salary(30_000, 15_000) })),
      30,
    );
    expect(full.map((c) => c.amount)).toEqual([30_000, 15_000]);
    const lop = earnedComponents(
      month(30, (d) => ({ salary: salary(30_000, 15_000), lop: d === 10 ? 1 : d === 11 ? 0.5 : 0 })),
      30,
    );
    expect(lop.map((c) => c.amount)).toEqual([28_500, 14_250]);
    // Joined on the 16th; revised on the 21st.
    const revised = earnedComponents(
      month(30, (d) => ({ salary: d < 16 ? null : d < 21 ? salary(30_000, 15_000) : salary(36_000, 18_000) })),
      30,
    );
    expect(revised.map((c) => [c.amount, c.rate])).toEqual([
      [17_000, 36_000],
      [8_500, 18_000],
    ]);
  });

  it('applies a loss-of-pay override at the latest salary', () => {
    const days = month(30, (d) => ({ salary: salary(30_000, 15_000), lop: d === 3 ? 1 : 0 }));
    expect(earnedComponents(days, 30, 2).map((c) => c.amount)).toEqual([28_000, 14_000]);
    expect(earnedComponents(days, 30, 0).map((c) => c.amount)).toEqual([30_000, 15_000]);
  });
});

describe('statutory contributions', () => {
  it('works out PF on wages up to the ceiling, with the EPS split and the age limit', () => {
    expect(pfContribution(30_000, { restrictToCeiling: true, age: 30 })).toMatchObject({ pfWage: 15_000, employee: 1_800, employerEps: 1_250, employerEpf: 550 });
    expect(pfContribution(30_000, { restrictToCeiling: false, age: 30 })).toMatchObject({ pfWage: 30_000, employee: 3_600, employerEps: 1_250, employerEpf: 2_350 });
    expect(pfContribution(10_000, { restrictToCeiling: true, age: 30 })).toMatchObject({ employee: 1_200, employerEps: 833, employerEpf: 367 });
    expect(pfContribution(15_000, { restrictToCeiling: true, age: 58 })).toMatchObject({ employee: 1_800, employerEps: 0, employerEpf: 1_800, epsWage: 0 });
  });

  it('rounds ESI up and fixes coverage per contribution period', () => {
    expect(esiContribution(18_208)).toEqual({ employee: 137, employer: 592 });
    expect(esiContribution(20_000)).toEqual({ employee: 150, employer: 650 });
    expect(esiCovered({ enabled: true, grossRate: 22_000, month: 4, coveredEarlierInPeriod: true })).toBe(false);
    // A raise mid-period doesn't end coverage until the next period.
    expect(esiCovered({ enabled: true, grossRate: 22_000, month: 6, coveredEarlierInPeriod: true })).toBe(true);
    expect(esiCovered({ enabled: true, grossRate: 20_000, month: 6, coveredEarlierInPeriod: null })).toBe(true);
    expect(esiCovered({ enabled: false, grossRate: 10_000, month: 4, coveredEarlierInPeriod: null })).toBe(false);
  });

  it('charges professional tax by state slab, gender and month', () => {
    const ka = professionalTaxState('Karnataka');
    expect([professionalTax(ka, 24_999, null, 5), professionalTax(ka, 25_000, null, 5), professionalTax(ka, 40_000, null, 2)]).toEqual([0, 200, 300]);
    const mh = professionalTaxState('mh');
    expect([professionalTax(mh, 9_000, 'MALE', 5), professionalTax(mh, 9_000, 'FEMALE', 5), professionalTax(mh, 30_000, 'FEMALE', 2)]).toEqual([175, 0, 300]);
    expect(professionalTax(professionalTaxState('WB'), 20_000, null, 5)).toBe(130);
    expect(professionalTaxState('Delhi')).toBeNull();
  });
});

describe('labour welfare fund and proof cut-off', () => {
  it('collects only in the state’s months, by the state’s rule', () => {
    const mh = labourWelfareState('Maharashtra');
    expect(labourWelfareFund(mh, 40000, 6)).toEqual({ employee: 25, employer: 75 });
    expect(labourWelfareFund(mh, 40000, 7)).toEqual({ employee: 0, employer: 0 });
    expect(labourWelfareFund(mh, 2500, 12)).toEqual({ employee: 0, employer: 0 });
    expect(labourWelfareFund(labourWelfareState('HR'), 10000, 3)).toEqual({ employee: 20, employer: 40 });
    expect(labourWelfareFund(labourWelfareState('Haryana'), 90000, 3)).toEqual({ employee: 34, employer: 68 });
    expect(labourWelfareFund(labourWelfareState('Kerala'), 30000, 9)).toEqual({ employee: 50, employer: 50 });
    expect(labourWelfareFund(null, 30000, 6)).toEqual({ employee: 0, employer: 0 });
    expect(labourWelfareState('Rajasthan')).toBeNull();
  });

  it('uses proofs from the cut-off month to March only', () => {
    expect(proofsApply(1, 12)).toBe(false);
    expect(proofsApply(1, 1)).toBe(true);
    expect(proofsApply(1, 3)).toBe(true);
    expect(proofsApply(1, 4)).toBe(false);
    expect(proofsApply(10, 11)).toBe(true);
    expect(proofsApply(null, 3)).toBe(false);
  });
});

describe('TDS', () => {
  const NEW: TaxDeclaration = {
    regime: 'NEW',
    rentPaidAnnual: 0,
    metroCity: false,
    section80c: 0,
    section80ccd1b: 0,
    section80d: 0,
    homeLoanInterest: 0,
    previousEmployerIncome: 0,
    previousEmployerTds: 0,
  };
  const figures = (taxable: number, basic = 0, hra = 0, employeePf = 0, professionalTax = 0) => ({ taxable, basic, hra, employeePf, professionalTax });

  it('spreads the projected annual tax over the months left', () => {
    // ₹1.5 lakh a month from April: 18 lakh gross, 17.25 lakh taxable → 1,45,000 + cess = 1,50,800 a year.
    const april = monthlyTds({ fy: 2026, age: 30, declaration: NEW, ytd: { ...figures(0), tds: 0 }, current: figures(150_000), recurring: figures(150_000), remainingMonths: 11 });
    expect(april).toMatchObject({ projectedGross: 18_00_000, standardDeduction: 75_000, remainingTax: 1_50_800, thisMonth: 12_567 });
    // In November with 7 months paid and 87,969 deducted, the rest is spread over 5 months.
    const nov = monthlyTds({ fy: 2026, age: 30, declaration: NEW, ytd: { ...figures(10_50_000), tds: 87_969 }, current: figures(150_000), recurring: figures(150_000), remainingMonths: 4 });
    expect(nov).toMatchObject({ remainingTax: 62_831, thisMonth: 12_566 });
  });

  it('deducts nothing when the projected income is within the rebate', () => {
    expect(monthlyTds({ fy: 2026, age: 30, declaration: NEW, ytd: { ...figures(0), tds: 0 }, current: figures(100_000), recurring: figures(100_000), remainingMonths: 11 }).thisMonth).toBe(0);
  });

  it('applies HRA exemption and chapter VI-A deductions under the old regime', () => {
    const declaration: TaxDeclaration = { ...NEW, regime: 'OLD', rentPaidAnnual: 3_00_000, metroCity: true, section80c: 1_00_000, section80d: 25_000 };
    const r = monthlyTds({
      fy: 2026,
      age: 30,
      declaration,
      ytd: { ...figures(0, 0, 0, 0, 0), tds: 0 },
      current: figures(100_000, 50_000, 25_000, 1_800, 200),
      recurring: figures(100_000, 50_000, 25_000, 1_800, 200),
      remainingMonths: 11,
    });
    // HRA exemption = min(3,00,000 HRA, 3,00,000 − 60,000, 3,00,000) = 2,40,000; 80C capped at 1.5 lakh incl. PF.
    expect(r.hraExemption).toBe(2_40_000);
    expect(r.deductions).toMatchObject({ section80c: 1_21_600, section80d: 25_000, professionalTax: 2_400 });
    expect(r.tax.taxableIncome).toBe(7_61_000);
  });

  it('works out age on a date', () => {
    expect(ageOn('1968-04-01', '2027-03-31')).toBe(58);
    expect(ageOn('1968-04-02', '2026-04-01')).toBe(57);
    expect(ageOn(null, '2026-04-01')).toBeNull();
  });
});
