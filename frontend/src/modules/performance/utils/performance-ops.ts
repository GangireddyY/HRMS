import type { ReviewStage } from '@contracts';
import { appLocale } from '@/core/locale/locale';
import { daysBetween as days, daysUntil, localToday } from '@/shared/utils/dates';

/** Helpers shared by the HR / manager performance pages (reviews, cycles, salary increases, improvement plans). */

/** Solid colour per stage, for dots, funnel bars and the strip (matches `stageTone`). */
export const STAGE_FILL: Record<ReviewStage, string> = {
  GOAL_SETTING: 'bg-fg-subtle',
  GOAL_APPROVAL: 'bg-warning',
  SELF_REVIEW: 'bg-info',
  MANAGER_REVIEW: 'bg-special',
  COMPLETED: 'bg-brand-500',
  ACKNOWLEDGED: 'bg-success',
};
export const STAGE_STRIP_TONE: Record<ReviewStage, string> = {
  GOAL_SETTING: 'neutral',
  GOAL_APPROVAL: 'warning',
  SELF_REVIEW: 'info',
  MANAGER_REVIEW: 'violet',
  COMPLETED: 'brand',
  ACKNOWLEDGED: 'success',
};

/** Short stage names for steppers and funnels, where the full label doesn't fit. */
export const STAGE_SHORT: Record<ReviewStage, string> = {
  GOAL_SETTING: 'Goals',
  GOAL_APPROVAL: 'Goal approval',
  SELF_REVIEW: 'Self-review',
  MANAGER_REVIEW: 'Manager review',
  COMPLETED: 'Completed',
  ACKNOWLEDGED: 'Acknowledged',
};

/** Bar colour per final rating (1 = lowest). */
export const RATING_FILL: Record<number, string> = { 1: 'bg-danger', 2: 'bg-caution', 3: 'bg-info', 4: 'bg-brand-500', 5: 'bg-special' };
export const RATING_TEXT: Record<number, string> = { 1: 'text-danger-fg', 2: 'text-caution-fg', 3: 'text-info-fg', 4: 'text-accent-fg', 5: 'text-special-fg' };

export const todayIso = localToday;

/** Whole days from today to `iso` (negative = in the past); timestamps count by their date. */
export const daysFromToday = (iso: string) => daysUntil(iso.slice(0, 10));
export const daysBetween = (from: string, to: string) => days(from.slice(0, 10), to.slice(0, 10));

const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
/** "tomorrow", "in 3 weeks", "2 months ago" for a calendar date. */
export function relativeDay(iso: string): string {
  const n = daysFromToday(iso);
  if (Math.abs(n) < 14) return rtf.format(n, 'day');
  if (Math.abs(n) < 60) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(Math.round(n / 30), 'month');
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** The calendar quarter containing `date`, shifted by `offset` quarters: { start, end, label: "Q4 2026" }. */
export function quarterOf(date: string, offset = 0): { start: string; end: string; label: string } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const index = Math.floor((m - 1) / 3) + offset;
  const year = y + Math.floor(index / 4);
  const q = ((index % 4) + 4) % 4;
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const mm = (n: number) => String(n).padStart(2, '0');
  return { start: `${year}-${mm(startMonth)}-01`, end: `${year}-${mm(endMonth)}-${mm(lastDay)}`, label: `Q${q + 1} ${year}` };
}
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
