const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Monthly instalment on the reducing balance, rounded up to the rupee so the last instalment is the smallest:
 * P·r·(1+r)^n / ((1+r)^n − 1) with r the monthly rate; P ÷ n when interest-free.
 */
export function loanEmi(principal: number, annualRate: number, months: number): number {
  if (annualRate <= 0) return Math.ceil(principal / months);
  const r = annualRate / 1200;
  const f = (1 + r) ** months;
  return Math.ceil((principal * r * f) / (f - 1));
}

export interface Instalment {
  principal: number;
  interest: number;
  amount: number;
}

/** The next instalment: a month's interest on what is still owed, the rest of the EMI off the principal (never more than is owed). */
export function nextInstalment(outstanding: number, annualRate: number, emi: number): Instalment {
  if (outstanding <= 0) return { principal: 0, interest: 0, amount: 0 };
  const interest = round2((outstanding * annualRate) / 1200);
  const principal = round2(Math.min(outstanding, Math.max(0, emi - interest)));
  return { principal, interest, amount: round2(principal + interest) };
}

export interface ScheduleRow extends Instalment {
  year: number;
  month: number;
  balance: number;
}

/** Instalments from a month until the loan is repaid (at most `limit` rows). */
export function repaymentSchedule(outstanding: number, annualRate: number, emi: number, from: { year: number; month: number }, limit = 120): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let balance = round2(outstanding);
  let { year, month } = from;
  while (balance > 0 && rows.length < limit) {
    const i = nextInstalment(balance, annualRate, emi);
    if (i.principal <= 0) break;
    balance = round2(balance - i.principal);
    rows.push({ year, month, ...i, balance });
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return rows;
}

export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
