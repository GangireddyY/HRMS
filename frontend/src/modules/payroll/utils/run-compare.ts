import type { PayrollRun } from '@/modules/payroll/types';

/** Months since year 0, so consecutive payroll months differ by one. */
export const monthIndex = (r: { year: number; month: number }) => r.year * 12 + r.month - 1;

/** The run for the month before `r` (cancelled runs don't count), if there is one. */
export function previousRun<T extends PayrollRun>(runs: T[], r: { year: number; month: number }): T | null {
  const target = monthIndex(r) - 1;
  return runs.find((x) => x.status !== 'CANCELLED' && monthIndex(x) === target) ?? null;
}

export interface Change {
  diff: number;
  /** Absolute percentage, one decimal. */
  pct: number;
  direction: 'up' | 'down' | 'same';
}
export function change(now: number, before: number): Change {
  const diff = now - before;
  return { diff, pct: before ? Math.abs(Math.round((diff / before) * 1000) / 10) : 0, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'same' };
}
