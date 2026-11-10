import { appCurrency } from '@/core/locale/currency';
import { appLocale } from '@/core/locale/locale';
const dateTime = new Intl.DateTimeFormat(appLocale(), { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(appLocale(), { dateStyle: 'medium' });
const relative = new Intl.RelativeTimeFormat(appLocale(), { numeric: 'auto' });

export function formatDateTime(value: string | Date | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

export function formatDate(value: string | Date | null | undefined): string {
  return value ? dateOnly.format(new Date(value)) : '—';
}

export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function fullName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '—';
}

/** Short, human-readable device description from a user-agent string. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|axios|supertest/i.test(ua) ? 'API client' : 'Browser';
  // iPhone and iPad agents also say "like Mac OS X", and Android ones say "Linux": check the mobile systems first.
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function humanize(value: string): string {
  return value.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatMoney(amount: number | null | undefined, currency = appCurrency()): string {
  if (amount === null || amount === undefined) return 'Custom';
  return new Intl.NumberFormat(appLocale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}
