import { monthRange } from '../../common/utils/zoned-time';
import { earnedComponents, type PayDay, type SalaryComponent } from './payroll-engine';

export interface ArrearSalary {
  effectiveFrom: string;
  components: SalaryComponent[];
  createdAt: Date;
}

/** A month already paid: its salary-component earnings and loss-of-pay days, and when the payslip was worked out. */
export interface PaidMonth {
  year: number;
  month: number;
  lopDays: number;
  /** Earnings lines of salary components (lines with a monthly rate). */
  components: { code: string; amount: number }[];
  calculatedAt: Date;
}

export interface ArrearAmounts {
  amount: number;
  taxable: number;
  pfWage: number;
  esiWage: number;
}

export interface ArrearMonth extends ArrearAmounts {
  year: number;
  month: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

/**
 * Arrears for months already paid. A salary revision recorded after a month's payslip was worked out, and in force on
 * any day of that month, changes what the month should have paid: the month is worked out again with today's salary
 * history and the same loss-of-pay days, and the difference from the salary components paid — less arrears already
 * paid for that month — is due. Months that come out lower (a back-dated cut) are returned negative; they are not
 * recovered automatically.
 */
export function arrearsFor(
  employment: { dateOfJoining: string; exitDate: string | null },
  salaries: ArrearSalary[],
  paid: PaidMonth[],
  alreadyPaid: Map<string, ArrearAmounts>,
): ArrearMonth[] {
  const history = [...salaries].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const out: ArrearMonth[] = [];
  for (const m of paid) {
    const { to, days } = monthRange(m.year, m.month);
    if (!history.some((s) => s.effectiveFrom <= to && s.createdAt > m.calculatedAt)) continue;
    const payDays: PayDay[] = days.map((date) => {
      const employed = date >= employment.dateOfJoining && (!employment.exitDate || date <= employment.exitDate);
      const salary = employed ? [...history].reverse().find((s) => s.effectiveFrom <= date) : undefined;
      return { date, salary: salary?.components ?? null, lop: 0 };
    });
    const earned = earnedComponents(payDays, days.length, m.lopDays);
    const paidBy = new Map(m.components.map((c) => [c.code, c.amount]));
    const due: ArrearAmounts = { amount: 0, taxable: 0, pfWage: 0, esiWage: 0 };
    for (const c of earned) {
      const diff = c.amount - (paidBy.get(c.code) ?? 0);
      paidBy.delete(c.code);
      due.amount += diff;
      if (c.taxable) due.taxable += diff;
      if (c.pfWage) due.pfWage += diff;
      if (c.esiWage) due.esiWage += diff;
    }
    // Components paid then but no longer in the salary.
    for (const amount of paidBy.values()) {
      due.amount -= amount;
      due.taxable -= amount;
    }
    const before = alreadyPaid.get(monthKey(m.year, m.month));
    const result: ArrearMonth = {
      year: m.year,
      month: m.month,
      amount: round2(due.amount - (before?.amount ?? 0)),
      taxable: round2(due.taxable - (before?.taxable ?? 0)),
      pfWage: round2(due.pfWage - (before?.pfWage ?? 0)),
      esiWage: round2(due.esiWage - (before?.esiWage ?? 0)),
    };
    if (Math.abs(result.amount) >= 1) out.push(result);
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}
