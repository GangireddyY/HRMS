import { describe, expect, it } from 'vitest';
import { inr, pct, slabSummary, toPercent, toRate } from './statutory';

describe('statutory rate formatting', () => {
  it('shows rates and rupees', () => {
    expect(pct(0.0833)).toBe('8.33%');
    expect(pct(0.12)).toBe('12%');
    expect(inr(1_200_000)).toBe('₹12,00,000');
    expect(slabSummary([{ upTo: 400_000, rate: 0 }, { upTo: 800_000, rate: 0.05 }, { upTo: null, rate: 0.3 }])).toBe('0% up to ₹4,00,000 · 5% up to ₹8,00,000 · 30% above');
  });

  it('converts form percentages to stored rates and back', () => {
    expect(toRate('8.33')).toBe(0.0833);
    expect(toRate(0.75)).toBe(0.0075);
    expect(toRate('12')).toBe(0.12);
    expect(toPercent(0.0325)).toBe(3.25);
    expect(toPercent(toRate('3.25'))).toBe(3.25);
  });
});
