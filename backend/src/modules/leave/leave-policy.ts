/**
 * Pure leave rules (no database): leave years, accrual schedules, carry-forward and day counting.
 * Dates are ISO `YYYY-MM-DD`; amounts are days with up to two decimals.
 */
import type { AccrualFrequency, LeaveSession } from '../../contracts';
import { addDays, weekday } from '../../common/utils/zoned-time';

const pad = (n: number) => String(n).padStart(2, '0');
export const round2 = (n: number) => Math.round(n * 100) / 100;
/** Nearest half day (used for prorated yearly quotas). */
export const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** The leave year a date belongs to, named after the calendar year it starts in. */
export function leaveYearOf(date: string, startMonth: number): number {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}

export function leaveYearRange(year: number, startMonth: number): { from: string; to: string } {
  const from = `${year}-${pad(startMonth)}-01`;
  return { from, to: addDays(`${year + 1}-${pad(startMonth)}-01`, -1) };
}

/** First day of each of the 12 months of a leave year, in order. */
export function leaveYearMonths(year: number, startMonth: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((startMonth - 1 + i) % 12) + 1;
    return `${startMonth - 1 + i >= 12 ? year + 1 : year}-${pad(m)}-01`;
  });
}

function lastDayOfMonth(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number) as [number, number];
  return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

export interface AccrualPolicy {
  id: string;
  annualQuota: number;
  accrualFrequency: AccrualFrequency;
  prorateOnJoining: boolean;
}

export interface Employment {
  id: string;
  dateOfJoining: string;
  exitDate: string | null;
}

export interface PlannedEntry {
  key: string;
  effectiveDate: string;
  days: number;
  note: string;
}

/**
 * Accrual credits due by `asOf` for one employee and leave type in a leave year.
 * YEARLY: the quota on the first day of the year (or the joining date), prorated by the months left when joining mid-year.
 * MONTHLY: 1/12 of the quota on the first of every month employed; the month of joining counts when joined by the 15th
 * (or always, without proration). Monthly amounts are cumulative-rounded so twelve months add up to the quota exactly.
 */
export function accrualPlan(policy: AccrualPolicy, employee: Employment, year: number, startMonth: number, asOf: string): PlannedEntry[] {
  if (policy.accrualFrequency === 'NONE' || policy.annualQuota <= 0) return [];
  const range = leaveYearRange(year, startMonth);
  if (employee.dateOfJoining > range.to || (employee.exitDate && employee.exitDate < range.from)) return [];
  const months = leaveYearMonths(year, startMonth);
  const joinedMonth = employee.dateOfJoining.slice(0, 7);
  const counts = (monthStart: string) => {
    const end = lastDayOfMonth(monthStart);
    if (employee.dateOfJoining > end) return false;
    if (employee.exitDate && employee.exitDate < monthStart) return false;
    if (monthStart.slice(0, 7) === joinedMonth && policy.prorateOnJoining) return Number(employee.dateOfJoining.slice(8, 10)) <= 15;
    return true;
  };

  if (policy.accrualFrequency === 'YEARLY') {
    const date = employee.dateOfJoining > range.from ? employee.dateOfJoining : range.from;
    if (date > asOf) return [];
    const eligibleMonths = employee.dateOfJoining > range.from && policy.prorateOnJoining ? months.filter((m) => m >= `${joinedMonth}-01` && counts(m)).length : 12;
    const days = eligibleMonths === 12 ? policy.annualQuota : roundHalf((policy.annualQuota * eligibleMonths) / 12);
    if (days <= 0) return [];
    return [{ key: `accrual:${policy.id}:${employee.id}:${year}`, effectiveDate: date, days, note: eligibleMonths === 12 ? 'Yearly quota' : `Yearly quota, prorated for ${eligibleMonths} months` }];
  }

  const out: PlannedEntry[] = [];
  months.forEach((monthStart, i) => {
    if (!counts(monthStart)) return;
    const date = employee.dateOfJoining > monthStart ? employee.dateOfJoining : monthStart;
    if (date > asOf) return;
    const days = round2(round2((policy.annualQuota * (i + 1)) / 12) - round2((policy.annualQuota * i) / 12));
    if (days > 0) out.push({ key: `accrual:${policy.id}:${employee.id}:${monthStart.slice(0, 7)}`, effectiveDate: date, days, note: `Monthly accrual (${monthStart.slice(0, 7)})` });
  });
  return out;
}

/** Year-end split of what is left: up to `limit` moves to the next year, the rest lapses. */
export function carryForward(remaining: number, limit: number): { carried: number; lapsed: number } {
  const left = Math.max(0, round2(remaining));
  const carried = Math.min(left, Math.max(0, limit));
  return { carried: round2(carried), lapsed: round2(left - carried) };
}

export interface CountedDay {
  date: string;
  /** 1, 0.5 or 0 (not counted). */
  portion: number;
  /** Why a day in the range does not count. */
  skipped?: 'WEEKLY_OFF' | 'HOLIDAY';
}

/**
 * Leave days between two dates. Weekly offs and (non-optional) holidays are skipped unless `countNonWorkingDays`;
 * a range may start in the afternoon (SECOND_HALF) and end at noon (FIRST_HALF); a single day may be a half.
 */
export function countLeaveDays(
  start: string,
  end: string,
  startSession: LeaveSession,
  endSession: LeaveSession,
  calendar: { weeklyOffs: number[]; holidays: Set<string>; countNonWorkingDays: boolean; restDays?: Set<string> },
): { days: number; breakdown: CountedDay[] } {
  const breakdown: CountedDay[] = [];
  // Rostered rest days (when known) replace the weekly offs of the usual shift.
  const isRest = (d: string) => (calendar.restDays ? calendar.restDays.has(d) : calendar.weeklyOffs.includes(weekday(d)));
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const skipped = calendar.countNonWorkingDays ? undefined : calendar.holidays.has(d) ? 'HOLIDAY' : isRest(d) ? 'WEEKLY_OFF' : undefined;
    let portion = skipped ? 0 : 1;
    if (portion && start === end && startSession !== 'FULL') portion = 0.5;
    else if (portion && d === start && start !== end && startSession === 'SECOND_HALF') portion = 0.5;
    else if (portion && d === end && start !== end && endSession === 'FIRST_HALF') portion = 0.5;
    breakdown.push({ date: d, portion, ...(skipped ? { skipped } : {}) });
  }
  return { days: breakdown.reduce((n, b) => n + b.portion, 0), breakdown };
}

/** Whether two requests take any of the same half-days. */
export function sessionsOverlap(
  a: { startDate: string; endDate: string; startSession: LeaveSession; endSession: LeaveSession },
  b: { startDate: string; endDate: string; startSession: LeaveSession; endSession: LeaveSession },
): boolean {
  if (a.endDate < b.startDate || b.endDate < a.startDate) return false;
  // Half-day slots: 2 per day, "AM" = 0, "PM" = 1.
  const slots = (r: typeof a) => {
    const from = r.startSession === 'SECOND_HALF' ? 1 : 0;
    const to = r.startDate === r.endDate ? (r.startSession === 'FIRST_HALF' ? 0 : 1) : r.endSession === 'FIRST_HALF' ? 0 : 1;
    return { from: `${r.startDate}:${from}`, to: `${r.endDate}:${to}` };
  };
  const x = slots(a);
  const y = slots(b);
  return x.from <= y.to && y.from <= x.to;
}
