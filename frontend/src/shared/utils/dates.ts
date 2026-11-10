/**
 * Calendar dates as YYYY-MM-DD strings. "Today" is the browser's local date — never `toISOString()`, which is the UTC
 * date and is still yesterday in India until 05:30.
 */
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function localToday(): string {
  return iso(new Date());
}

/** `date` plus `days` calendar days (negative to go back); safe across DST changes. */
export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Days from today until `date` (negative when it has passed). */
export const daysUntil = (date: string) => daysBetween(localToday(), date);
