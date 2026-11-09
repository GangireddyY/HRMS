import { appLocale } from '@/core/locale/locale';

const DAY = 86_400_000;
const relative = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });

/** Today as `YYYY-MM-DD` in the browser's time zone. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from today to a `YYYY-MM-DD` date: negative in the past, 0 today. */
export function daysUntil(iso: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / DAY);
}

/** "today", "tomorrow", "in 3 days", "2 days ago"; months and years once days stop being useful. */
export function relativeDays(iso: string): string {
  const d = daysUntil(iso);
  if (Math.abs(d) < 45) return relative.format(d, 'day');
  if (Math.abs(d) < 365) return relative.format(Math.round(d / 30.44), 'month');
  return relative.format(Math.round(d / 365.25), 'year');
}

/** "3 yrs 2 mos" of service since a `YYYY-MM-DD` date; "Not started" for a future date. */
export function tenure(from: string): string {
  const [y, m, d] = from.slice(0, 10).split('-').map(Number);
  const now = new Date();
  let months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (now.getDate() < d) months--;
  if (daysUntil(from) > 0) return 'Not started';
  if (months < 1) return 'Under a month';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years && `${years} yr${years === 1 ? '' : 's'}`, rest && `${rest} mo${rest === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}
