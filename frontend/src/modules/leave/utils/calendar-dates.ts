/** Calendar arithmetic on ISO dates (`YYYY-MM-DD`, no time zone). Weeks start on Monday. */

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const mondayOf = (iso: string): string => addDays(iso, -((weekday(iso) + 6) % 7));
export const isWeekend = (iso: string): boolean => [0, 6].includes(weekday(iso));

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Whole weeks covering a month: Monday on or before the 1st to Sunday on or after the last day. */
export function monthGrid(month: string): { from: string; to: string } {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: mondayOf(first), to: addDays(mondayOf(last), 6) };
}

export const formatIso = (iso: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
