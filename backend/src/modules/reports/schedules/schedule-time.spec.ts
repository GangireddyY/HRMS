import { reportPeriod } from '../../../contracts';
import { nextRunAt } from './schedule-time';

describe('nextRunAt', () => {
  const ist = 'Asia/Kolkata';

  it('daily: today at the hour if still ahead, else tomorrow', () => {
    // 08:00 IST = 02:30 UTC.
    expect(nextRunAt({ frequency: 'DAILY', hour: 8 }, new Date('2026-11-11T01:00:00Z'), ist).toISOString()).toBe('2026-11-11T02:30:00.000Z');
    expect(nextRunAt({ frequency: 'DAILY', hour: 8 }, new Date('2026-11-11T02:30:00Z'), ist).toISOString()).toBe('2026-11-12T02:30:00.000Z');
  });

  it('weekly: the next chosen weekday', () => {
    // 2026-11-11 is a Wednesday; Monday = 1.
    expect(nextRunAt({ frequency: 'WEEKLY', dayOfWeek: 1, hour: 9 }, new Date('2026-11-11T05:00:00Z'), 'UTC').toISOString()).toBe('2026-11-16T09:00:00.000Z');
    expect(nextRunAt({ frequency: 'WEEKLY', dayOfWeek: 3, hour: 9 }, new Date('2026-11-11T05:00:00Z'), 'UTC').toISOString()).toBe('2026-11-11T09:00:00.000Z');
  });

  it('monthly: the day of this month if ahead, else next month', () => {
    expect(nextRunAt({ frequency: 'MONTHLY', dayOfMonth: 1, hour: 7 }, new Date('2026-11-11T05:00:00Z'), 'UTC').toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(nextRunAt({ frequency: 'MONTHLY', dayOfMonth: 28, hour: 7 }, new Date('2026-11-11T05:00:00Z'), 'UTC').toISOString()).toBe('2026-11-28T07:00:00.000Z');
  });
});

describe('reportPeriod', () => {
  it('covers the expected dates', () => {
    expect(reportPeriod('PREVIOUS_DAY', '2026-03-01')).toEqual({ from: '2026-02-28', to: '2026-02-28' });
    expect(reportPeriod('PREVIOUS_WEEK', '2026-11-11')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
    expect(reportPeriod('PREVIOUS_MONTH', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(reportPeriod('MONTH_TO_DATE', '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-11' });
    expect(reportPeriod('LAST_30_DAYS', '2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(reportPeriod('SAVED', '2026-11-11')).toBeNull();
  });
});
