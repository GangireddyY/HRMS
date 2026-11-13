import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysBetween, daysFromToday, pct, plural, quarterOf, relativeDay } from './performance-ops';

describe('performance helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 10));
  });
  afterEach(() => vi.useRealTimers());

  it('finds calendar quarters, also across years', () => {
    expect(quarterOf('2026-11-12')).toEqual({ start: '2026-10-01', end: '2026-12-31', label: 'Q4 2026' });
    expect(quarterOf('2026-11-12', 1)).toEqual({ start: '2027-01-01', end: '2027-03-31', label: 'Q1 2027' });
    expect(quarterOf('2026-02-10', -1)).toEqual({ start: '2025-10-01', end: '2025-12-31', label: 'Q4 2025' });
    expect(quarterOf('2028-05-01').end).toBe('2028-06-30');
  });

  it('counts days from today and between timestamps by their date', () => {
    expect(daysFromToday('2026-11-15T23:00:00Z')).toBe(3);
    expect(daysBetween('2026-11-01T08:00:00Z', '2026-11-30T20:00:00Z')).toBe(29);
  });

  it('describes dates relative to today', () => {
    expect(relativeDay('2026-11-13')).toMatch(/tomorrow/i);
    expect(relativeDay('2026-12-10')).toMatch(/4 weeks/);
    expect(relativeDay('2026-08-10')).toMatch(/3 months ago/);
  });

  it('pluralizes and computes percentages', () => {
    expect(plural(1, 'goal')).toBe('1 goal');
    expect(plural(3, 'goal')).toBe('3 goals');
    expect(plural(2, 'person', 'people')).toBe('2 people');
    expect(pct(1, 3)).toBe(33);
    expect(pct(5, 0)).toBe(0);
  });
});
