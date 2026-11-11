import { digestDue, wantsWhatsApp, type NotificationSettings } from './notifications';

describe('digestDue', () => {
  const daily: NotificationSettings = { emailDigest: 'DAILY', digestHour: 9, timezone: 'Asia/Kolkata' };

  it('is never due when digests are off or email is off', () => {
    expect(digestDue({}, new Date('2026-11-11T05:00:00Z'))).toBe(false);
    expect(digestDue({ ...daily, email: false }, new Date('2026-11-11T05:00:00Z'))).toBe(false);
  });

  it('goes out from the local hour, once per local day', () => {
    // 09:00 IST = 03:30 UTC.
    expect(digestDue(daily, new Date('2026-11-11T03:29:00Z'))).toBe(false);
    expect(digestDue(daily, new Date('2026-11-11T03:30:00Z'))).toBe(true);
    expect(digestDue({ ...daily, lastDigestAt: '2026-11-11T03:31:00Z' }, new Date('2026-11-11T10:00:00Z'))).toBe(false);
    // Catches up later the same day, and is due again the next morning.
    expect(digestDue({ ...daily, lastDigestAt: '2026-11-10T03:31:00Z' }, new Date('2026-11-11T12:00:00Z'))).toBe(true);
    expect(digestDue({ ...daily, lastDigestAt: '2026-11-11T03:31:00Z' }, new Date('2026-11-12T03:45:00Z'))).toBe(true);
  });

  it('weekly digests wait for the chosen weekday', () => {
    const weekly: NotificationSettings = { emailDigest: 'WEEKLY', digestHour: 8, digestDay: 1, timezone: 'UTC' };
    expect(digestDue(weekly, new Date('2026-11-11T09:00:00Z'))).toBe(false); // Wednesday
    expect(digestDue(weekly, new Date('2026-11-16T08:05:00Z'))).toBe(true); // Monday
    expect(digestDue({ ...weekly, lastDigestAt: '2026-11-16T08:05:00Z' }, new Date('2026-11-16T15:00:00Z'))).toBe(false);
  });
});

describe('wantsWhatsApp', () => {
  const on: NotificationSettings = { whatsapp: true, whatsappNumber: '+919876543210', whatsappVerifiedAt: '2026-11-01T00:00:00Z' };

  it('needs the channel on and a verified number', () => {
    expect(wantsWhatsApp(on, 'leave.request')).toBe(true);
    expect(wantsWhatsApp({ ...on, whatsapp: false }, 'leave.request')).toBe(false);
    expect(wantsWhatsApp({ ...on, whatsappVerifiedAt: null }, 'leave.request')).toBe(false);
  });

  it('follows muted categories and ignores unknown types', () => {
    expect(wantsWhatsApp({ ...on, muted: ['leave'] }, 'leave.request')).toBe(false);
    expect(wantsWhatsApp(on, 'engagement.announcement')).toBe(false); // muted by default
    expect(wantsWhatsApp(on, 'security.alert')).toBe(false);
  });
});
