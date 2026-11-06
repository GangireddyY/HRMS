import type { DayStatus, RegularizationStatus } from '@contracts';

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  IN_PROGRESS: 'In progress',
  MISSED_PUNCH: 'Missed punch-out',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  UPCOMING: 'Not yet',
  NOT_EMPLOYED: '—',
};

export const dayStatusTone: Record<DayStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'violet'> = {
  PRESENT: 'success',
  HALF_DAY: 'warning',
  ABSENT: 'danger',
  IN_PROGRESS: 'info',
  MISSED_PUNCH: 'warning',
  HOLIDAY: 'violet',
  WEEKLY_OFF: 'neutral',
  UPCOMING: 'neutral',
  NOT_EMPLOYED: 'neutral',
};

/** Calendar cell accents (background + dot), tuned for light and dark mode. */
export const dayStatusCell: Record<DayStatus, string> = {
  PRESENT: 'bg-emerald-500/10 ring-emerald-500/25 text-emerald-700 dark:text-emerald-300',
  HALF_DAY: 'bg-amber-500/10 ring-amber-500/25 text-amber-700 dark:text-amber-300',
  ABSENT: 'bg-red-500/10 ring-red-500/25 text-red-700 dark:text-red-300',
  IN_PROGRESS: 'bg-sky-500/10 ring-sky-500/30 text-sky-700 dark:text-sky-300',
  MISSED_PUNCH: 'bg-orange-500/10 ring-orange-500/30 text-orange-700 dark:text-orange-300',
  HOLIDAY: 'bg-violet-500/10 ring-violet-500/25 text-violet-700 dark:text-violet-300',
  WEEKLY_OFF: 'bg-surface-muted ring-line text-fg-subtle',
  UPCOMING: 'bg-surface ring-line text-fg-muted',
  NOT_EMPLOYED: 'bg-surface-muted/40 ring-line/60 text-fg-subtle opacity-60',
};

export const REGULARIZATION_LABELS: Record<RegularizationStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const regularizationTone: Record<RegularizationStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 125 → "2h 05m". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Local time of an instant in the employee's time zone, e.g. "09:05". */
export function formatTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
