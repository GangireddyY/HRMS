import type { TaxSlab } from '@contracts';

/** 0.0833 → "8.33%". */
export const pct = (n: number) => `${Number((n * 100).toFixed(2))}%`;

/** ₹ amounts the Indian way (12,00,000). */
export const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** "0% up to ₹4,00,000 · 5% up to ₹8,00,000 · … · 30% above". */
export function slabSummary(slabs: TaxSlab[]): string {
  return slabs.map((s) => (s.upTo === null ? `${pct(s.rate)} above` : `${pct(s.rate)} up to ${inr(s.upTo)}`)).join(' · ');
}

/** Percent typed in a form ("8.33") → a rate (0.0833), rounded to the 4 decimals the database keeps. */
export const toRate = (v: string | number) => Math.round(Number(v) * 100) / 10_000;
/** A rate → percent for a form field. */
export const toPercent = (r: number) => Number((r * 100).toFixed(2));
