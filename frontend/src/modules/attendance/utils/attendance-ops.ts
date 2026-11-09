import { appLocale } from '@/core/locale/locale';

/** Helpers for the HR / manager attendance pages: calendar-day arithmetic on ISO dates and relative wording. */

/** Today in the browser's time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "today", "yesterday", "in 3 days", "2 weeks ago", "9 months ago" for a calendar date relative to `today`. */
export function relativeDay(date: string, today: string = localToday()): string {
  const n = daysBetween(today, date);
  const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
  if (Math.abs(n) >= 60) return rtf.format(Math.round(n / 30.4), 'month');
  if (Math.abs(n) >= 14) return rtf.format(Math.round(n / 7), 'week');
  return rtf.format(n, 'day');
}

/** Month / day / weekday parts for a date tile. */
export function dateTile(date: string): { day: number; month: string; weekday: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(appLocale(), { ...o, timeZone: 'UTC' }).format(d);
  return { day: d.getUTCDate(), month: f({ month: 'short' }), weekday: f({ weekday: 'short' }) };
}

/** "Monday, 9 November". */
export function longDay(date: string): string {
  return new Intl.DateTimeFormat(appLocale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/** "09:30" → 570. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + (m || 0);
}

/** Hours a request has been waiting, and whether it is past the two-day review target. */
export function waiting(createdAt: string): { label: string; tone: 'neutral' | 'warning' | 'danger'; overdue: boolean } {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  const rtf = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });
  const label = hours < 1 ? 'just now' : hours < 24 ? rtf.format(-Math.round(hours), 'hour') : rtf.format(-Math.round(hours / 24), 'day');
  return { label, tone: hours >= 48 ? 'danger' : hours >= 24 ? 'warning' : 'neutral', overdue: hours >= 48 };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
