import type { Loan } from '../types';

type LoanLike = Pick<Loan, 'emi' | 'outstanding' | 'interestRate' | 'tenureMonths' | 'instalmentsPaid'>;

/**
 * Instalments still to deduct, from the outstanding balance rather than the count of payroll deductions, so a
 * direct repayment (which reduces the balance without a payroll instalment) shortens the remaining schedule.
 */
export function instalmentsLeft(l: LoanLike): number {
  if (!l.emi || l.outstanding <= 0) return 0;
  const r = l.interestRate / 1200;
  if (!r) return Math.ceil(l.outstanding / l.emi - 1e-9);
  const x = 1 - (r * l.outstanding) / l.emi;
  if (x <= 0) return Math.max(0, l.tenureMonths - l.instalmentsPaid);
  return Math.ceil(-Math.log(x) / Math.log(1 + r) - 1e-9);
}

/** Which instalment comes next, e.g. 2 of 3 (counts a direct repayment as instalments covered). */
export const nextInstalmentNumber = (l: LoanLike) => Math.min(l.tenureMonths, l.tenureMonths - instalmentsLeft(l) + 1);
