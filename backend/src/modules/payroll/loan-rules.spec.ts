import { loanEmi, monthIndex, nextInstalment, repaymentSchedule } from './loan-rules';

describe('loan rules', () => {
  it('works out the monthly instalment', () => {
    expect(loanEmi(60000, 0, 6)).toBe(10000);
    expect(loanEmi(50000, 0, 3)).toBe(16667);
    // ₹1,00,000 at 12% a year over 12 months: ₹8,884.88, rounded up.
    expect(loanEmi(100000, 12, 12)).toBe(8885);
  });

  it('splits each instalment into interest on the balance and principal', () => {
    expect(nextInstalment(100000, 12, 8885)).toEqual({ interest: 1000, principal: 7885, amount: 8885 });
    expect(nextInstalment(3000, 12, 8885)).toEqual({ interest: 30, principal: 3000, amount: 3030 });
    expect(nextInstalment(10000, 0, 10000)).toEqual({ interest: 0, principal: 10000, amount: 10000 });
    expect(nextInstalment(0, 12, 8885)).toEqual({ interest: 0, principal: 0, amount: 0 });
  });

  it('builds the repayment schedule until the loan is repaid', () => {
    const interestFree = repaymentSchedule(50000, 0, 16667, { year: 2026, month: 11 });
    expect(interestFree.map((r) => [r.year, r.month, r.principal, r.balance])).toEqual([
      [2026, 11, 16667, 33333],
      [2026, 12, 16667, 16666],
      [2027, 1, 16666, 0],
    ]);
    const withInterest = repaymentSchedule(100000, 12, 8885, { year: 2027, month: 1 });
    expect(withInterest).toHaveLength(12);
    expect(withInterest[11]!.balance).toBe(0);
    expect(withInterest[11]!.amount).toBeLessThanOrEqual(8885);
    const totalInterest = withInterest.reduce((s, r) => s + r.interest, 0);
    expect(Math.round(totalInterest)).toBe(6618);
    expect(monthIndex(2027, 1) - monthIndex(2026, 12)).toBe(1);
  });
});
