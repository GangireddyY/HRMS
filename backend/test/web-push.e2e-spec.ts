import { PushSubscription } from '../src/database/models';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PushService, type PushPayload } from '../src/modules/notifications/push.service';
import { API, RAW, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Web Push notifications (e2e)', () => {
  let ctx: TestContext;
  let push: PushService;
  let sent: { endpoint: string; payload: PushPayload; vapid: string }[];
  let original: PushService['sender'];
  const gone = new Set<string>();

  beforeAll(async () => {
    ctx = await createTestApp();
    push = ctx.app.get(PushService);
    original = push.sender;
    push.sender = async (target, payload, options) => {
      if (gone.has(target.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as PushPayload, vapid: options.vapidDetails?.publicKey ?? '' });
      return { statusCode: 201, body: '', headers: {} };
    };
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    sent = [];
    gone.clear();
  });
  afterAll(async () => {
    push.sender = original;
    await ctx.close();
  });

  const device = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: 'BOr4_' + 'x'.repeat(80), auth: 'a'.repeat(22) } });
  const flush = () => new Promise((r) => setTimeout(r, 200));

  it('pushes notifications to the browsers a person subscribed, within their preferences', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    const status = (await ctx.http().get(`${API}/notifications/push`).set(h)).body.data;
    expect(status).toMatchObject({ enabled: true, on: true, devices: 0 });
    expect(status.publicKey).toBe(process.env.VAPID_PUBLIC_KEY);

    expect((await ctx.http().post(`${API}/notifications/push/subscriptions`).set(h).send({ endpoint: 'http://evil.test/x', keys: device(1).keys })).status).toBe(422);
    expect((await ctx.http().post(`${API}/notifications/push/subscriptions`).set(h).send(device(1))).body.data.devices).toBe(1);
    await ctx.http().post(`${API}/notifications/push/subscriptions`).set(h).send(device(2));
    // The same browser subscribing again is updated, not duplicated.
    expect((await ctx.http().post(`${API}/notifications/push/subscriptions`).set(h).send(device(2))).body.data.devices).toBe(2);

    const notifications = ctx.app.get(NotificationsService);
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Asha asked for 2 days of leave', body: '12–13 Nov', link: '/hr/leave/requests', organizationId: organization.id });
    await flush();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([device(1).endpoint, device(2).endpoint]);
    expect(sent[0]!.payload).toEqual({ title: 'Asha asked for 2 days of leave', body: '12–13 Nov', url: '/hr/leave/requests', tag: 'leave.request' });
    expect(sent[0]!.vapid).toBe(process.env.VAPID_PUBLIC_KEY);

    // Grievance pushes carry no case details.
    sent = [];
    await notifications.notify(admin.id, { type: 'grievance.updated', title: 'Case GRV-0007: hearing on Friday', body: 'Statement from the respondent', organizationId: organization.id });
    await flush();
    expect(sent[0]!.payload).toMatchObject({ title: "There's an update on a grievance case", body: 'Open HRMS to see it.' });
    expect(JSON.stringify(sent)).not.toContain('GRV-0007');

    // Muted categories and the push switch are respected.
    sent = [];
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: ['leave'] });
    await notifications.notify(admin.id, { type: 'leave.request', title: 'Muted', organizationId: organization.id });
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], push: false });
    await notifications.notify(admin.id, { type: 'payroll.payslip', title: 'Off', organizationId: organization.id });
    await flush();
    expect(sent).toEqual([]);
    expect((await ctx.http().get(`${API}/notifications/settings`).set(h)).body.data).toMatchObject({ push: false, email: true });
    // Changing email settings alone keeps the push choice.
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: false, muted: [] });
    expect((await ctx.http().get(`${API}/notifications/push`).set(h)).body.data.on).toBe(false);

    // A browser the push service says is gone (410) is dropped; unsubscribing removes one explicitly.
    await ctx.http().put(`${API}/notifications/settings`).set(h).send({ email: true, muted: [], push: true });
    gone.add(device(1).endpoint);
    await notifications.notify(admin.id, { type: 'payroll.payslip', title: 'Your payslip is ready', organizationId: organization.id });
    await flush();
    expect(sent.map((s) => s.endpoint)).toEqual([device(2).endpoint]);
    expect(await PushSubscription.count({ where: { userId: admin.id }, ...RAW })).toBe(1);
    expect((await ctx.http().post(`${API}/notifications/push/unsubscribe`).set(h).send({ endpoint: device(2).endpoint })).body.data.devices).toBe(0);
  });
});
