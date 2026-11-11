import { User } from '../src/database/models';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { NotificationDigestService } from '../src/modules/notifications/digest.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { WhatsAppService, type WhatsAppMessage } from '../src/modules/notifications/whatsapp.service';
import { API, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Notification digests and WhatsApp (e2e)', () => {
  let ctx: TestContext;
  let whatsapp: WhatsAppService;
  let mail: MailService;
  let messages: WhatsAppMessage[];
  let original: WhatsAppService['sender'];

  beforeAll(async () => {
    ctx = await createTestApp();
    whatsapp = ctx.app.get(WhatsAppService);
    mail = ctx.app.get(MailService);
    original = whatsapp.sender;
    whatsapp.sender = async (m) => {
      messages.push(m);
    };
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    messages = [];
    mail.outbox.length = 0;
  });
  afterAll(async () => {
    whatsapp.sender = original;
    await ctx.close();
  });

  const flush = () => new Promise((r) => setTimeout(r, 200));

  it('holds emails for a daily summary sent at the chosen local hour', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    const notifications = ctx.app.get(NotificationsService);
    const sentTo = () => mail.outbox.filter((m) => m.to === admin.email);

    // As they happen (default): one email per notification.
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Asha asked for leave', organizationId: organization.id });
    await flush();
    expect(sentTo()).toHaveLength(1);

    expect((await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], emailDigest: 'DAILY', digestHour: 9, timezone: 'Mars/Olympus' })).status).toBe(422);
    // Switching to a summary starts its window now: the email already sent isn't repeated.
    const saved = (await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: ['engagement'], emailDigest: 'DAILY', digestHour: 9, timezone: 'Asia/Kolkata' })).body.data;
    expect(saved).toMatchObject({ emailDigest: 'DAILY', digestHour: 9, timezone: 'Asia/Kolkata' });
    mail.outbox.length = 0;

    await notifications.notify(admin.id, { type: 'leave.request', title: 'Ravi asked for 2 days', body: '12–13 Nov', link: '/hr/leave/requests', organizationId: organization.id });
    await notifications.notify(admin.id, { type: 'payroll.claim', title: 'Meera claimed ₹2,400', organizationId: organization.id });
    await notifications.notify(admin.id, { type: 'grievance.updated', title: 'Case GRV-0007: hearing on Friday', organizationId: organization.id });
    await notifications.notify(admin.id, { type: 'engagement.announcement', title: 'Muted category', organizationId: organization.id });
    await flush();
    expect(sentTo()).toHaveLength(0);

    // Before 09:00 IST nothing goes out; from 09:00 one summary, once that day.
    const digests = ctx.app.get(NotificationDigestService);
    // Tomorrow, so the notifications above fall inside the summary's window.
    const day = new Date(Date.now() + 86_400_000);
    const at = (utcHour: number, utcMinute: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), utcHour, utcMinute));
    expect(await digests.tick(at(3, 0))).toBe(0);
    expect(await digests.tick(at(3, 45))).toBe(1);
    expect(await digests.tick(at(4, 30))).toBe(0);
    const [digest] = sentTo();
    expect(digest!.subject).toContain('daily');
    expect(digest!.text).toContain('Ravi asked for 2 days');
    expect(digest!.text).toContain('Meera claimed');
    expect(digest!.text).not.toContain('Muted category');
    expect(digest!.text).not.toContain('Asha asked for leave');
    expect(digest!.text).not.toContain('GRV-0007');
    expect(digest!.text).toContain("There's an update on a grievance case");

    // Back to one email per notification.
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], emailDigest: 'OFF' });
    mail.outbox.length = 0;
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Immediate again', organizationId: organization.id });
    await flush();
    expect(sentTo()).toHaveLength(1);
  });

  it('confirms a WhatsApp number with a code, then sends notifications there', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    const notifications = ctx.app.get(NotificationsService);
    expect((await ctx.http().get(`${API}/notifications/settings`).set(h)).body.data.whatsapp).toEqual({ available: true, on: false, number: null, verified: false, pendingNumber: null });

    // Can't switch it on without a confirmed number; numbers need a country code.
    expect((await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], whatsapp: true })).status).toBe(409);
    expect((await ctx.http().post(`${API}/notifications/whatsapp/verify`).set(h).send({ number: '98765 43210' })).status).toBe(422);
    const pending = (await ctx.http().post(`${API}/notifications/whatsapp/verify`).set(h).send({ number: '+91 98765 43210' })).body.data;
    expect(pending.whatsapp).toMatchObject({ pendingNumber: '+919876543210', verified: false });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ to: '+919876543210', template: 'hrms_verification_code' });
    const code = messages[0]!.params[0]!;
    expect(code).toMatch(/^\d{6}$/);
    // The code is never returned or stored in clear.
    expect(JSON.stringify(pending)).not.toContain(code);
    expect(JSON.stringify((await User.findByPk(admin.id))!.notificationSettings)).not.toContain(`"${code}"`);

    const wrong = code === '000000' ? '111111' : '000000';
    expect((await ctx.http().post(`${API}/notifications/whatsapp/confirm`).set(h).send({ code: wrong })).status).toBe(422);
    const confirmed = (await ctx.http().post(`${API}/notifications/whatsapp/confirm`).set(h).send({ code })).body.data;
    expect(confirmed.whatsapp).toEqual({ available: true, on: true, number: '+919876543210', verified: true, pendingNumber: null });
    // A used code can't be replayed.
    expect((await ctx.http().post(`${API}/notifications/whatsapp/confirm`).set(h).send({ code })).status).toBe(409);

    messages = [];
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Asha asked for 2 days of leave', link: '/hr/leave/requests', organizationId: organization.id });
    await notifications.notify(admin.id, { type: 'grievance.updated', title: 'Case GRV-0007: hearing on Friday', organizationId: organization.id });
    await flush();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ to: '+919876543210', template: 'hrms_notification', params: ['Asha asked for 2 days of leave', expect.stringContaining('/hr/leave/requests')] });
    expect(JSON.stringify(messages[1])).not.toContain('GRV-0007');

    // Muted categories and the switch are respected; removing the number stops everything.
    messages = [];
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: ['leave'] });
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Muted', organizationId: organization.id });
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], whatsapp: false });
    await notifications.notify(admin.id, { type: 'payroll.payslip', title: 'Off', organizationId: organization.id });
    await flush();
    expect(messages).toEqual([]);
    expect((await ctx.http().post(`${API}/notifications/whatsapp/remove`).set(h)).body.data.whatsapp).toMatchObject({ on: false, number: null, verified: false });

    // At most 3 codes an hour.
    for (let i = 0; i < 3; i++) await ctx.http().post(`${API}/notifications/whatsapp/verify`).set(h).send({ number: '+919876543210' });
    expect((await ctx.http().post(`${API}/notifications/whatsapp/verify`).set(h).send({ number: '+919876543210' })).status).toBe(429);
  });
});
