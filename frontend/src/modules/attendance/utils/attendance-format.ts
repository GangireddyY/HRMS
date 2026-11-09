import { appLocale } from '@/core/locale/locale';
import type { DayStatus, OvertimeStatus, RegularizationStatus } from '@contracts';

export const DAY_STATUS_LABELS: Record<DayStatus, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  IN_PROGRESS: 'In progress',
  MISSED_PUNCH: 'Missed punch-out',
  ON_LEAVE: 'On leave',
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
  ON_LEAVE: 'info',
  HOLIDAY: 'violet',
  WEEKLY_OFF: 'neutral',
  UPCOMING: 'neutral',
  NOT_EMPLOYED: 'neutral',
};

/** Calendar cell accents (background + dot), tuned for light and dark mode. */
export const dayStatusCell: Record<DayStatus, string> = {
  PRESENT: 'bg-success/10 ring-success/25 text-success-fg',
  HALF_DAY: 'bg-warning/10 ring-warning/25 text-warning-fg',
  ABSENT: 'bg-danger/10 ring-danger/25 text-danger-fg',
  IN_PROGRESS: 'bg-info/10 ring-info/30 text-info-fg',
  MISSED_PUNCH: 'bg-caution/10 ring-caution/30 text-caution-fg',
  ON_LEAVE: 'bg-away/10 ring-away/30 text-away-fg',
  HOLIDAY: 'bg-special/10 ring-special/25 text-special-fg',
  WEEKLY_OFF: 'bg-surface-muted ring-line text-fg-subtle',
  UPCOMING: 'bg-surface ring-line text-fg-muted',
  NOT_EMPLOYED: 'bg-surface-muted/40 ring-line/60 text-fg-subtle opacity-60',
};

export const REGULARIZATION_LABELS: Record<RegularizationStatus, string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const regularizationTone: Record<RegularizationStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };

export const OVERTIME_LABELS: Record<OvertimeStatus, string> = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved' };
export const overtimeTone: Record<OvertimeStatus, 'warning' | 'success' | 'danger'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

/** "12 Nov" or "12–14 Nov". */
/** Locale-aware: "23–24 Nov" in en-IN, "Nov 23 – 24" in en-US. */
export function dateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const day = (d: string) => new Date(`${d}T00:00:00Z`);
  return start === end ? fmt.format(day(start)) : fmt.formatRange(day(start), day(end));
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
  return new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(appLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
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
