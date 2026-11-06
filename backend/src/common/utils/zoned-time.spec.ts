import { addDays, minutesToTime, monthRange, timeToMinutes, weekday, zonedInstant, zonedParts } from './zoned-time';

describe('zoned time helpers', () => {
  it('reads local dates and times in a time zone', () => {
    // 20:00 UTC on 31 Jan is 01:30 on 1 Feb in India.
    expect(zonedParts(new Date('2026-01-31T20:00:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-02-01', minutes: 90 });
    expect(zonedParts(new Date('2026-01-31T20:00:00Z'), 'America/New_York')).toEqual({ date: '2026-01-31', minutes: 15 * 60 });
  });

  it('converts local wall-clock times to instants, including across DST', () => {
    expect(zonedInstant('2026-02-01', 9 * 60 + 30, 'Asia/Kolkata').toISOString()).toBe('2026-02-01T04:00:00.000Z');
    // New York: EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(zonedInstant('2026-01-15', 9 * 60, 'America/New_York').toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedInstant('2026-07-15', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-15T13:00:00.000Z');
    // Minutes past midnight roll into the next day (night shifts).
    expect(zonedInstant('2026-02-01', 26 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-02-01T20:30:00.000Z');
  });

  it('handles plain date and time arithmetic', () => {
    expect(timeToMinutes('09:15:00')).toBe(555);
    expect(minutesToTime(1500)).toBe('01:00');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(weekday('2026-11-08')).toBe(0);
    expect(monthRange(2028, 2).days).toHaveLength(29);
  });
});
