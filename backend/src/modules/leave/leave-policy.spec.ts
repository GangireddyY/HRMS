import { accrualPlan, carryForward, countLeaveDays, leaveYearMonths, leaveYearOf, leaveYearRange, sessionsOverlap } from './leave-policy';

const employee = (dateOfJoining: string, exitDate: string | null = null) => ({ id: 'e1', dateOfJoining, exitDate });
const yearly = { id: 't1', annualQuota: 12, accrualFrequency: 'YEARLY' as const, prorateOnJoining: true };
const monthly = { id: 't2', annualQuota: 15, accrualFrequency: 'MONTHLY' as const, prorateOnJoining: true };
const total = (entries: { days: number }[]) => Math.round(entries.reduce((n, e) => n + e.days, 0) * 100) / 100;

describe('leave years', () => {
  it('supports calendar and April–March leave years', () => {
    expect(leaveYearOf('2026-03-31', 1)).toBe(2026);
    expect(leaveYearOf('2026-03-31', 4)).toBe(2025);
    expect(leaveYearOf('2026-04-01', 4)).toBe(2026);
    expect(leaveYearRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(leaveYearRange(2025, 4)).toEqual({ from: '2025-04-01', to: '2026-03-31' });
    expect(leaveYearMonths(2025, 4)).toEqual([
      '2025-04-01',
      '2025-05-01',
      '2025-06-01',
      '2025-07-01',
      '2025-08-01',
      '2025-09-01',
      '2025-10-01',
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });
});

describe('accrualPlan', () => {
  it('credits the yearly quota at the start of the year and prorates mid-year joiners', () => {
    expect(accrualPlan(yearly, employee('2020-01-01'), 2026, 1, '2026-01-01')).toEqual([expect.objectContaining({ effectiveDate: '2026-01-01', days: 12 })]);
    expect(accrualPlan(yearly, employee('2020-01-01'), 2026, 1, '2025-12-31')).toEqual([]);
    // Joined 10 July: July–December = 6 months → 6 days.
    expect(accrualPlan(yearly, employee('2026-07-10'), 2026, 1, '2026-08-01')).toEqual([expect.objectContaining({ effectiveDate: '2026-07-10', days: 6 })]);
    // Joined 20 July: the joining month no longer counts → 5 months → 5 days.
    expect(accrualPlan(yearly, employee('2026-07-20'), 2026, 1, '2026-08-01')[0]!.days).toBe(5);
    expect(accrualPlan({ ...yearly, prorateOnJoining: false }, employee('2026-07-20'), 2026, 1, '2026-08-01')[0]!.days).toBe(12);
  });

  it('credits monthly accruals up to the as-of date and adds up to the quota over a full year', () => {
    const march = accrualPlan(monthly, employee('2020-01-01'), 2026, 1, '2026-03-15');
    expect(march.map((e) => e.effectiveDate)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(total(march)).toBe(3.75);
    expect(total(accrualPlan(monthly, employee('2020-01-01'), 2026, 1, '2026-12-31'))).toBe(15);
    expect(total(accrualPlan({ ...monthly, annualQuota: 10 }, employee('2020-01-01'), 2026, 1, '2026-12-31'))).toBe(10);
    // Unique keys per month make repeated runs idempotent.
    expect(new Set(march.map((e) => e.key)).size).toBe(3);
  });

  it('respects joining and exit dates', () => {
    const joiner = accrualPlan(monthly, employee('2026-03-10'), 2026, 1, '2026-05-01');
    expect(joiner.map((e) => e.effectiveDate)).toEqual(['2026-03-10', '2026-04-01', '2026-05-01']);
    const late = accrualPlan(monthly, employee('2026-03-20'), 2026, 1, '2026-05-01');
    expect(late.map((e) => e.effectiveDate)).toEqual(['2026-04-01', '2026-05-01']);
    const leaver = accrualPlan(monthly, employee('2020-01-01', '2026-02-10'), 2026, 1, '2026-12-31');
    expect(leaver.map((e) => e.effectiveDate)).toEqual(['2026-01-01', '2026-02-01']);
    expect(accrualPlan(monthly, employee('2027-01-05'), 2026, 1, '2026-12-31')).toEqual([]);
    expect(accrualPlan({ ...monthly, accrualFrequency: 'NONE' }, employee('2020-01-01'), 2026, 1, '2026-12-31')).toEqual([]);
  });
});

describe('carryForward', () => {
  it('carries up to the limit and lapses the rest', () => {
    expect(carryForward(12.5, 10)).toEqual({ carried: 10, lapsed: 2.5 });
    expect(carryForward(4, 10)).toEqual({ carried: 4, lapsed: 0 });
    expect(carryForward(4, 0)).toEqual({ carried: 0, lapsed: 4 });
    expect(carryForward(-2, 10)).toEqual({ carried: 0, lapsed: 0 });
  });
});

describe('countLeaveDays', () => {
  const calendar = { weeklyOffs: [0, 6], holidays: new Set(['2026-11-04']), countNonWorkingDays: false };

  it('skips weekly offs and holidays', () => {
    // Mon 2 Nov – Mon 9 Nov 2026: Wed 4 is a holiday, Sat/Sun are off → 5 days.
    const r = countLeaveDays('2026-11-02', '2026-11-09', 'FULL', 'FULL', calendar);
    expect(r.days).toBe(5);
    expect(r.breakdown.find((d) => d.date === '2026-11-04')).toMatchObject({ portion: 0, skipped: 'HOLIDAY' });
    expect(r.breakdown.find((d) => d.date === '2026-11-07')).toMatchObject({ portion: 0, skipped: 'WEEKLY_OFF' });
  });

  it('counts everything with the sandwich rule', () => {
    expect(countLeaveDays('2026-11-02', '2026-11-09', 'FULL', 'FULL', { ...calendar, countNonWorkingDays: true }).days).toBe(8);
  });

  it('handles half days', () => {
    expect(countLeaveDays('2026-11-02', '2026-11-02', 'FIRST_HALF', 'FIRST_HALF', calendar).days).toBe(0.5);
    expect(countLeaveDays('2026-11-02', '2026-11-03', 'SECOND_HALF', 'FIRST_HALF', calendar).days).toBe(1);
    expect(countLeaveDays('2026-11-07', '2026-11-08', 'FULL', 'FULL', calendar).days).toBe(0);
  });
});

describe('sessionsOverlap', () => {
  const r = (startDate: string, endDate: string, startSession = 'FULL', endSession = startSession) => ({ startDate, endDate, startSession, endSession }) as Parameters<typeof sessionsOverlap>[0];
  it('lets a morning and an afternoon of the same day coexist', () => {
    expect(sessionsOverlap(r('2026-11-02', '2026-11-02', 'FIRST_HALF'), r('2026-11-02', '2026-11-02', 'SECOND_HALF'))).toBe(false);
    expect(sessionsOverlap(r('2026-11-02', '2026-11-02', 'FULL'), r('2026-11-02', '2026-11-02', 'SECOND_HALF'))).toBe(true);
    expect(sessionsOverlap(r('2026-11-02', '2026-11-03', 'FULL', 'FIRST_HALF'), r('2026-11-03', '2026-11-03', 'SECOND_HALF'))).toBe(false);
    expect(sessionsOverlap(r('2026-11-02', '2026-11-05'), r('2026-11-05', '2026-11-06'))).toBe(true);
    expect(sessionsOverlap(r('2026-11-02', '2026-11-03'), r('2026-11-04', '2026-11-06'))).toBe(false);
  });
});
