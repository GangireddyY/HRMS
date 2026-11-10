import { arrearsFor, monthKey, type ArrearSalary, type PaidMonth } from './arrears';
import type { SalaryComponent } from './payroll-engine';

const salary = (basic: number, hra: number): SalaryComponent[] => [
  { componentId: 'b', code: 'BASIC', name: 'Basic', role: 'BASIC', monthly: basic, taxable: true, pfWage: true, esiWage: true },
  { componentId: 'h', code: 'HRA', name: 'HRA', role: 'HRA', monthly: hra, taxable: true, pfWage: false, esiWage: true },
];
const paidAt = new Date('2026-09-30T12:00:00Z');
const revisedAt = new Date('2026-10-20T09:00:00Z');
const employment = { dateOfJoining: '2024-01-08', exitDate: null };

describe('arrears for back-dated revisions', () => {
  const before: ArrearSalary = { effectiveFrom: '2024-01-08', components: salary(20_000, 10_000), createdAt: new Date('2024-01-08T00:00:00Z') };
  // Raise of 10% from 1 August, recorded in October after August and September were paid.
  const raise: ArrearSalary = { effectiveFrom: '2026-08-01', components: salary(22_000, 11_000), createdAt: revisedAt };
  const month = (m: number, lopDays = 0): PaidMonth => ({
    year: 2026,
    month: m,
    lopDays,
    components: [
      { code: 'BASIC', amount: m === 8 || m === 9 ? Math.round((20_000 * (30 - lopDays)) / 30) : 22_000 },
      { code: 'HRA', amount: m === 8 || m === 9 ? Math.round((10_000 * (30 - lopDays)) / 30) : 11_000 },
    ],
    calculatedAt: paidAt,
  });

  it('pays the difference for each month paid before the revision was recorded', () => {
    const due = arrearsFor(employment, [before, raise], [{ ...month(7), components: [{ code: 'BASIC', amount: 20_000 }, { code: 'HRA', amount: 10_000 }] }, month(8), month(9)], new Map());
    expect(due.map((d) => [d.month, d.amount, d.pfWage])).toEqual([
      [8, 3000, 2000],
      [9, 3000, 2000],
    ]);
  });

  it('keeps the loss-of-pay days of the month', () => {
    const [sep] = arrearsFor(employment, [before, raise], [month(9, 3)], new Map());
    // September has 30 days: 27 paid days × 3,000 / 30.
    expect(sep!.amount).toBe(2700);
  });

  it('does not pay twice, and ignores months worked out after the revision', () => {
    const paid = new Map([[monthKey(2026, 8), { amount: 3000, taxable: 3000, pfWage: 2000, esiWage: 3000 }]]);
    expect(arrearsFor(employment, [before, raise], [month(8)], paid)).toEqual([]);
    expect(arrearsFor(employment, [before, raise], [{ ...month(9), calculatedAt: new Date('2026-10-25T00:00:00Z') }], new Map())).toEqual([]);
  });

  it('reports a back-dated cut as negative', () => {
    const cut: ArrearSalary = { effectiveFrom: '2026-09-01', components: salary(18_000, 9_000), createdAt: revisedAt };
    expect(arrearsFor(employment, [before, cut], [month(9)], new Map())[0]).toMatchObject({ month: 9, amount: -3000 });
  });
});
