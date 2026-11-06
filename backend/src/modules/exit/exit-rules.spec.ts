import { addWorkingDays, dailyRate, gratuityAmount, gratuityEligibility, gratuityYears, noticeEnd, noticeShortfall, serviceLength, settlementLines } from './exit-rules';

describe('exit rules', () => {
  it('works out the notice period and days not served', () => {
    expect(noticeEnd('2026-11-01', 30)).toBe('2026-11-30');
    expect(noticeEnd('2026-11-01', 90)).toBe('2027-01-29');
    expect(noticeShortfall('2026-11-30', '2026-11-20', false)).toBe(10);
    expect(noticeShortfall('2026-11-30', '2026-11-20', true)).toBe(0);
    expect(noticeShortfall('2026-11-30', '2026-12-05', false)).toBe(0);
  });

  it('measures service and the years counted for gratuity', () => {
    expect(serviceLength('2020-01-08', '2025-06-30')).toEqual({ years: 5, months: 5, days: 23 });
    expect(gratuityYears(serviceLength('2020-01-08', '2025-06-30'))).toBe(5);
    expect(serviceLength('2020-01-08', '2025-07-31')).toEqual({ years: 5, months: 6, days: 24 });
    expect(gratuityYears(serviceLength('2020-01-08', '2025-07-31'))).toBe(6);
    expect(serviceLength('2020-01-08', '2025-08-10')).toEqual({ years: 5, months: 7, days: 3 });
    expect(gratuityYears(serviceLength('2020-01-08', '2025-08-10'))).toBe(6);
    expect(serviceLength('2026-01-01', '2026-12-31')).toEqual({ years: 1, months: 0, days: 0 });
  });

  it('decides gratuity eligibility', () => {
    expect(gratuityEligibility('RESIGNATION', 'FULL_TIME', { years: 4 })).toMatchObject({ eligible: false });
    expect(gratuityEligibility('RESIGNATION', 'FULL_TIME', { years: 5 })).toMatchObject({ eligible: true });
    expect(gratuityEligibility('DEATH', 'FULL_TIME', { years: 1 })).toMatchObject({ eligible: true });
    expect(gratuityEligibility('CONTRACT_END', 'CONTRACT', { years: 1 })).toMatchObject({ eligible: true, basis: expect.stringMatching(/fixed-term/) });
  });

  it('calculates gratuity at 15/26 of monthly Basic per year, capped at ₹20 lakh', () => {
    expect(gratuityAmount(50000, 6)).toBe(173077);
    expect(gratuityAmount(500000, 10)).toBe(2000000);
  });

  it('uses the chosen daily rate and counts working days for the due date', () => {
    expect(dailyRate('BASIC_26', 26000, 60000)).toBe(1000);
    expect(dailyRate('BASIC_30', 30000, 60000)).toBe(1000);
    expect(dailyRate('GROSS_30', 30000, 60000)).toBe(2000);
    expect(addWorkingDays('2026-11-06', 2)).toBe('2026-11-10');
    expect(addWorkingDays('2026-11-04', 2)).toBe('2026-11-06');
  });

  it('builds the full & final statement', () => {
    const base = {
      monthlyBasic: 30000,
      monthlyGross: 60000,
      encashment: [{ code: 'EL', name: 'Earned leave', days: 10 }],
      encashmentBasis: 'BASIC_30' as const,
      gratuity: { include: true, years: 6 },
      shortfallDays: 5,
      noticeBasis: 'GROSS_30' as const,
      recoveries: [{ id: '0123456789', title: 'Laptop not returned', amount: 2500 }],
      adjustments: [
        { label: 'Performance bonus', kind: 'EARNING' as const, amount: 5000 },
        { label: 'Income tax (TDS)', kind: 'DEDUCTION' as const, amount: 3000 },
      ],
    };
    const resigned = settlementLines({ ...base, type: 'RESIGNATION' });
    expect(resigned.lines.map((l) => [l.code, l.kind, l.amount])).toEqual([
      ['LEAVE_EL', 'EARNING', 10000],
      ['GRATUITY', 'EARNING', 103846],
      ['NOTICE_RECOVERY', 'DEDUCTION', 10000],
      ['CLEARANCE_01234567', 'DEDUCTION', 2500],
      ['ADJ_1', 'EARNING', 5000],
      ['ADJ_2', 'DEDUCTION', 3000],
    ]);
    expect(resigned).toMatchObject({ totalEarnings: 118846, totalDeductions: 15500, net: 103346 });
    // The employer pays notice in lieu instead.
    const terminated = settlementLines({ ...base, type: 'TERMINATION', gratuity: null, recoveries: [], adjustments: [] });
    expect(terminated.lines.map((l) => [l.code, l.kind, l.amount])).toEqual([
      ['LEAVE_EL', 'EARNING', 10000],
      ['NOTICE_PAY', 'EARNING', 10000],
    ]);
    expect(terminated.net).toBe(20000);
  });
});
