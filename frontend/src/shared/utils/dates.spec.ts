import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDaysIso, daysBetween, daysUntil, localToday } from './dates';
import { fullName, plural } from './text';

describe('dates', () => {
  afterEach(() => vi.useRealTimers());

  it('uses the local date, not the UTC one', () => {
    // 01:00 on 10 Nov in India is still 9 Nov in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 1, 0));
    expect(localToday()).toBe('2026-11-10');
  });

  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2028-03-01', -1)).toBe('2028-02-29');
  });

  it('counts whole days', () => {
    expect(daysBetween('2026-11-01', '2026-11-10')).toBe(9);
    expect(daysBetween('2026-11-10', '2026-11-01')).toBe(-9);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 23, 30));
    expect(daysUntil('2026-11-12')).toBe(2);
  });
});

describe('text', () => {
  it('pluralizes and joins names', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(3, 'person', 'people')).toBe('3 people');
    expect(fullName({ firstName: 'Asha ', lastName: '' })).toBe('Asha');
  });
});
