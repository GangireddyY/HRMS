import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeUserAgent, formatDate, formatDateTime, formatMoney, fullName, humanize, timeAgo } from './format';

describe('formatting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('formats dates, with a dash for none', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDate('2026-11-12')).toMatch(/2026/);
    expect(formatDateTime('2026-11-12T10:00:00Z')).toMatch(/2026/);
  });

  it('says how long ago something happened', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo('2026-11-12T09:59:40Z')).toBe('just now');
    expect(timeAgo('2026-11-12T09:55:00Z')).toMatch(/5 minutes ago/);
    expect(timeAgo('2026-11-10T10:00:00Z')).toMatch(/2 days ago/);
    expect(timeAgo('2026-11-14T10:00:00Z')).toMatch(/in 2 days/);
  });

  it('names people, devices and keys', () => {
    expect(fullName({ firstName: 'Asha', lastName: 'Rao' })).toBe('Asha Rao');
    expect(fullName(null)).toBe('—');
    expect(describeUserAgent(null)).toBe('Unknown device');
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari/605.1.15')).toBe('Safari on iOS');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(describeUserAgent('curl/8.4.0')).toBe('API client');
    expect(humanize('leave.request_approved')).toBe('Leave Request Approved');
  });

  it('formats money, or "Custom" when there is no price', () => {
    expect(formatMoney(null)).toBe('Custom');
    expect(formatMoney(150000, 'INR')).toMatch(/1,50,000|150,000/);
    expect(formatMoney(99, 'USD')).toMatch(/99/);
  });
});
