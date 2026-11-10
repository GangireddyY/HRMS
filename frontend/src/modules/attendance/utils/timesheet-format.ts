import type { TimesheetMissedAction, TimesheetWeekStatus } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import type { TimesheetDayKind } from '../types';

export const TIMESHEET_LABELS: Record<TimesheetWeekStatus, string> = {
  MISSING: 'Missing',
  DRAFT: 'Draft',
  SUBMITTED: 'Waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Sent back',
};
export const timesheetTone: Record<TimesheetWeekStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  MISSING: 'danger',
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'warning',
};

export const MISSED_ACTION_LABELS: Record<TimesheetMissedAction, { label: string; short: string; description: string }> = {
  FLAG: { label: 'Flag on the payslip', short: 'Flagged', description: 'Payroll shows a warning on the payslip. Pay is not affected.' },
  LOP: { label: 'Count as unpaid days', short: 'Unpaid days', description: 'Working days of a missed week are loss of pay (LOP) in that month’s payroll.' },
  HOLD: { label: 'Hold the salary', short: 'Salary held', description: 'The salary is held in the payroll run until the timesheets are approved and the run is recalculated.' },
};

export const DAY_KIND_LABELS: Record<TimesheetDayKind, string> = { WORKING: 'Working day', WEEKLY_OFF: 'Weekly off', HOLIDAY: 'Holiday', LEAVE: 'On leave', NOT_EMPLOYED: 'Not employed' };

const longWeekday = (day: number) => new Intl.DateTimeFormat(appLocale(), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));
/** Weekday names, 0 = Sunday. */
export const WEEKDAY_NAMES = [0, 1, 2, 3, 4, 5, 6].map(longWeekday);

/** "7.5" from 450 minutes; "" for nothing. */
export function toHours(minutes: number): string {
  if (!minutes) return '';
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100);
}

/** Minutes from what someone typed: "7.5", "7,5", "7:30", "7h30", "45m". Null when it isn't a duration. */
export function parseHours(input: string): number | null {
  const v = input.trim().toLowerCase().replace(',', '.');
  if (!v) return 0;
  const clock = v.match(/^(\d{1,2})\s*[:h]\s*(\d{1,2})?\s*m?$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2] ?? 0);
  const mins = v.match(/^(\d{1,4})\s*m(in)?$/);
  if (mins) return Number(mins[1]);
  const num = Number(v.replace(/h$/, ''));
  if (Number.isFinite(num) && num >= 0) return Math.round(num * 60);
  return null;
}

/** "7h 30m", "8h", "—" for nothing. */
export function hoursLabel(minutes: number | null | undefined): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? (h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`) : `${h}h`;
}

/** "Mon 9" header parts for a date. */
export function dayParts(date: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(appLocale(), { ...o, timeZone: 'UTC' }).format(d);
  return { weekday: fmt({ weekday: 'short' }), day: fmt({ day: 'numeric' }), month: fmt({ month: 'short' }) };
}

/** "Mon, 16 Nov". */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
