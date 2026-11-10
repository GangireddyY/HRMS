import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '@/app/router/route-effects';
import { hoursLabel, parseHours, toHours } from '@/modules/attendance/utils/timesheet-format';
import { caseSla } from '@/modules/grievance/utils/case-sla';
import { instalmentsLeft, nextInstalmentNumber } from '@/modules/payroll/utils/loan-progress';
import { change, previousRun } from '@/modules/payroll/utils/run-compare';
import type { PayrollRun } from '@/modules/payroll/types';
import { krProgressText } from '@/modules/performance/utils/performance-format';
import { quarterOf } from '@/modules/performance/utils/performance-ops';

describe('OKR periods and key results', () => {
  it('finds calendar quarters, across year ends', () => {
    expect(quarterOf('2026-11-10')).toEqual({ start: '2026-10-01', end: '2026-12-31', label: 'Q4 2026' });
    expect(quarterOf('2026-11-10', 1)).toEqual({ start: '2027-01-01', end: '2027-03-31', label: 'Q1 2027' });
    expect(quarterOf('2026-02-14', -1)).toEqual({ start: '2025-10-01', end: '2025-12-31', label: 'Q4 2025' });
    expect(quarterOf('2028-05-01')).toMatchObject({ start: '2028-04-01', end: '2028-06-30' });
  });

  it('describes where a key result stands', () => {
    const money = (n: number) => `Rs ${n}`;
    expect(krProgressText({ metric: 'NUMBER', unit: 'deals', startValue: 0, targetValue: 40, currentValue: 26 }, money)).toBe('26 of 40 deals');
    expect(krProgressText({ metric: 'NUMBER', unit: 'ms', startValue: 450, targetValue: 200, currentValue: 260 }, money)).toBe('260 ms · target 200 ms');
    expect(krProgressText({ metric: 'PERCENT', unit: '%', startValue: 18, targetValue: 25, currentValue: 21.5 }, money)).toBe('21.5% of 25%');
    expect(krProgressText({ metric: 'CURRENCY', unit: null, startValue: 0, targetValue: 500, currentValue: 120 }, money)).toBe('Rs 120 of Rs 500');
    expect(krProgressText({ metric: 'MILESTONE', unit: null, startValue: 0, targetValue: 1, currentValue: 1 }, money)).toBe('Milestone · Done');
  });
});

describe('timesheet hours', () => {
  it('reads what people type as minutes', () => {
    expect(parseHours('7.5')).toBe(450);
    expect(parseHours('7,5')).toBe(450);
    expect(parseHours('7:30')).toBe(450);
    expect(parseHours('7h30')).toBe(450);
    expect(parseHours('45m')).toBe(45);
    expect(parseHours('8h')).toBe(480);
    expect(parseHours('')).toBe(0);
    expect(parseHours('lunch')).toBeNull();
  });

  it('shows minutes as hours', () => {
    expect(toHours(450)).toBe('7.5');
    expect(toHours(0)).toBe('');
    expect(hoursLabel(450)).toBe('7h 30m');
    expect(hoursLabel(480)).toBe('8h');
    expect(hoursLabel(45)).toBe('45m');
    expect(hoursLabel(null)).toBe('—');
  });
});

describe('grievance SLA', () => {
  const open = { status: 'IN_REVIEW' as const, submittedOn: '2026-11-01', dueOn: '2026-11-21', overdue: false };
  it('places an open case against its target date', () => {
    expect(caseSla(open, '2026-11-05')).toMatchObject({ state: 'ok', left: 16, text: '16 days left' });
    expect(caseSla(open, '2026-11-15')).toMatchObject({ state: 'soon', left: 6 });
    expect(caseSla(open, '2026-11-21')).toMatchObject({ state: 'today', text: 'Target date is today' });
    expect(caseSla(open, '2026-11-23')).toMatchObject({ state: 'overdue', left: -2, used: 100, text: '2 days past target' });
    expect(caseSla({ ...open, overdue: true }, '2026-11-05').state).toBe('overdue');
  });
  it('treats resolved and closed cases as done', () => {
    expect(caseSla({ ...open, status: 'CLOSED' }, '2026-12-30').state).toBe('done');
  });
});

describe('payroll comparisons', () => {
  const run = (year: number, month: number, status = 'PAID') => ({ id: `${year}-${month}`, year, month, status }) as unknown as PayrollRun;
  it('finds the previous month across a year end, skipping cancelled runs', () => {
    const runs = [run(2025, 12), run(2026, 1, 'CANCELLED'), run(2026, 2)];
    expect(previousRun(runs, { year: 2026, month: 1 })?.id).toBe('2025-12');
    expect(previousRun(runs, { year: 2026, month: 2 })).toBeNull();
  });
  it('describes a change in percent', () => {
    expect(change(110, 100)).toEqual({ diff: 10, pct: 10, direction: 'up' });
    expect(change(90, 120)).toEqual({ diff: -30, pct: 25, direction: 'down' });
    expect(change(5, 0)).toMatchObject({ pct: 0, direction: 'up' });
  });
});

describe('loan schedule', () => {
  it('counts instalments left from the balance, so direct repayments shorten it', () => {
    const loan = { emi: 10_000, outstanding: 30_000, interestRate: 0, tenureMonths: 6, instalmentsPaid: 2 };
    expect(instalmentsLeft(loan)).toBe(3);
    expect(nextInstalmentNumber(loan)).toBe(4);
    expect(instalmentsLeft({ ...loan, outstanding: 0 })).toBe(0);
    // With 1 % a month, interest can push the schedule one instalment past the plain division.
    expect(instalmentsLeft({ ...loan, interestRate: 12, outstanding: 28_000 })).toBe(3);
    expect(instalmentsLeft({ ...loan, interestRate: 12, outstanding: 29_500 })).toBe(4);
  });
});

describe('route effects', () => {
  it('recognises stale lazy chunks after a deploy', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: /assets/Page-abc.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Network error'))).toBe(false);
  });
});
