import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSince, daysUntil, dueText, dueTone, shortDay, stageAge, timeOfDay } from './recruitment-ui';

describe('recruitment dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 15, 30));
  });
  afterEach(() => vi.useRealTimers());

  it('counts calendar days to and since a date', () => {
    expect(daysUntil('2026-11-12')).toBe(0);
    expect(daysUntil('2026-11-15')).toBe(3);
    expect(daysUntil('2026-11-10')).toBe(-2);
    expect(daysSince(new Date(2026, 10, 9, 15, 30).toISOString())).toBe(3);
    expect(daysSince(new Date(2026, 10, 20).toISOString())).toBe(0);
  });

  it('says when something is due, and colours it', () => {
    expect(dueText('2026-11-12')).toBe('Today');
    expect(dueText('2026-11-13')).toBe('Tomorrow');
    expect(dueText('2026-11-16')).toBe('In 4 days');
    expect(dueText('2026-11-11')).toBe('1 day overdue');
    expect(dueText('2026-11-09', false)).toBe('3 days ago');
    expect(dueTone('2026-11-11')).toBe('text-danger-fg');
    expect(dueTone('2026-11-18')).toBe('text-warning-fg');
    expect(dueTone('2026-12-31')).toBe('text-fg-muted');
  });

  it('flags candidates stuck in a stage', () => {
    expect(stageAge(new Date(2026, 10, 12, 9).toISOString())).toEqual({ days: 0, label: 'Today', tone: 'fresh' });
    expect(stageAge(new Date(2026, 10, 4, 15).toISOString())).toMatchObject({ days: 8, tone: 'slow' });
    expect(stageAge(new Date(2026, 9, 20).toISOString())).toMatchObject({ label: '23d', tone: 'stuck' });
  });

  it('formats times and days', () => {
    expect(timeOfDay(new Date(2026, 10, 12, 9, 5).toISOString())).toMatch(/9:05/);
    expect(shortDay(new Date(2026, 10, 12).toISOString())).toMatch(/12/);
  });
});
