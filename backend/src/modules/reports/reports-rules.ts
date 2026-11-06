import type { EmployeeStatus } from '../../contracts';
import { addDays, monthRange } from '../../common/utils/zoned-time';

export interface PersonFacts {
  dateOfJoining: string;
  exitDate: string | null;
  status: EmployeeStatus;
}

/** On the payroll on a date: joined by then and not yet past the last working day. */
export const employedOn = (e: PersonFacts, date: string) => e.dateOfJoining <= date && (e.exitDate ? e.exitDate >= date : e.status !== 'EXITED');

/** Left in a period: the last working day falls in it (and has passed). */
export const leftIn = (e: PersonFacts, from: string, to: string, today: string) => !!e.exitDate && e.exitDate >= from && e.exitDate <= to && e.exitDate <= today;

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (n: number, d: number) => (d > 0 ? round1((n / d) * 100) : null);

/** Monthly headcount (at month end, or the as-of day for its month), joiners and leavers for the months up to `asOf`. */
export function headcountTrend(people: PersonFacts[], asOf: string, months: number) {
  const [y, m] = asOf.split('-').map(Number) as [number, number];
  const out: { month: string; headcount: number; joiners: number; leavers: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    const { from, to } = monthRange(Math.floor(total / 12), (total % 12) + 1);
    const end = to < asOf ? to : asOf;
    out.push({
      month: from.slice(0, 7),
      headcount: people.filter((p) => employedOn(p, end)).length,
      joiners: people.filter((p) => p.dateOfJoining >= from && p.dateOfJoining <= end).length,
      leavers: people.filter((p) => leftIn(p, from, end, asOf)).length,
    });
  }
  return out;
}

/** Leavers as a share of the average headcount over the period, and the same rate projected over a year. */
export function attritionRate(leavers: number, startHeadcount: number, endHeadcount: number, days: number): { rate: number | null; annualized: number | null } {
  const average = (startHeadcount + endHeadcount) / 2;
  if (average <= 0) return { rate: null, annualized: null };
  const raw = (leavers / average) * 100;
  return { rate: round1(raw), annualized: days > 0 ? round1((raw * 365) / days) : null };
}

export const TENURE_BANDS = ['Under 1 year', '1–3 years', '3–5 years', '5 years or more'] as const;
/** Completed years of service by anniversary (the last working day included). */
export function completedYears(joined: string, left: string): number {
  const end = addDays(left, 1);
  const years = Number(end.slice(0, 4)) - Number(joined.slice(0, 4));
  return end.slice(5) < joined.slice(5) ? years - 1 : years;
}

export function tenureBand(joined: string, left: string): (typeof TENURE_BANDS)[number] {
  const years = completedYears(joined, left);
  if (years < 1) return TENURE_BANDS[0];
  if (years < 3) return TENURE_BANDS[1];
  if (years < 5) return TENURE_BANDS[2];
  return TENURE_BANDS[3];
}

/** Counts per key, largest first (ties by name), with each key's share of the total. */
export function countBy<T>(items: T[], key: (item: T) => string): { name: string; count: number; share: number | null }[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count, share: pct(count, items.length) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : round1((s[mid - 1]! + s[mid]!) / 2);
}

/** "2026-01" … "2026-12": the months from one YYYY-MM to another. */
export function monthsBetween(from: string, to: string): { year: number; month: number }[] {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  const out: { year: number; month: number }[] = [];
  for (let t = fy * 12 + fm - 1; t <= ty * 12 + tm - 1; t++) out.push({ year: Math.floor(t / 12), month: (t % 12) + 1 });
  return out;
}
