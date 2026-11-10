import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { API, TestContext, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Notification emails (e2e)', () => {
  let ctx: TestContext;
  let notifications: NotificationsService;

  beforeAll(async () => {
    ctx = await createTestApp();
    notifications = ctx.app.get(NotificationsService);
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const settle = () => new Promise((r) => setTimeout(r, 50));
  const sentTo = (to: string) => ctx.mail.outbox.filter((m) => m.to === to);

  it('emails workflow notifications, keeps grievance details out and respects each person’s choices', async () => {
    const org = await createOrgWithAdmin(ctx);
    const to = org.admin.email;
    const orgId = org.organization.id;

    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'leave.request', title: 'Asha asked for 2 days off', body: 'Family function', link: '/hr/leave/requests' });
    await settle();
    expect(sentTo(to)).toHaveLength(1);
    const leave = sentTo(to)[0]!;
    expect(leave.subject).toContain('Asha asked for 2 days off');
    expect(leave.subject).toContain(org.organization.name);
    expect(leave.text).toContain('http://localhost:5173/hr/leave/requests');
    expect(leave.text).toContain('Family function');

    // Off by default, already emailed separately, or not a workflow category.
    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'engagement.announcement', title: 'Town hall on Friday' });
    await notifications.notify(org.admin.id, { type: 'security', title: 'Two-factor authentication enabled' });
    await notifications.notify(org.admin.id, { type: 'test', title: 'Hello' });
    await settle();
    expect(sentTo(to)).toHaveLength(1);

    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'grievance.case', title: 'New POSH complaint GRV-0001', link: '/hr/grievances/x' });
    await settle();
    const grievance = sentTo(to)[1]!;
    expect(grievance.subject).not.toContain('POSH');
    expect(grievance.text).not.toContain('GRV-0001');
    expect(grievance.text).toContain('Sign in to see the details');

    // Rolled back: no email.
    await ctx.db.sequelize
      .transaction(async (transaction) => {
        await notifications.notify(org.admin.id, { organizationId: orgId, type: 'payroll.run', title: 'Payroll is waiting' }, transaction);
        throw new Error('rollback');
      })
      .catch(() => undefined);
    await settle();
    expect(sentTo(to)).toHaveLength(2);

    const session = await login(ctx, to);
    const current = await ctx.http().get(`${API}/notifications/settings`).set(bearer(session.accessToken));
    expect(current.status).toBe(200);
    expect(current.body.data).toMatchObject({ email: true, muted: ['engagement'] });
    expect(current.body.data.categories.some((c: { key: string }) => c.key === 'leave')).toBe(true);

    const bad = await ctx
      .http()
      .put(`${API}/notifications/settings`)
      .set(bearer(session.accessToken))
      .send({ email: true, muted: ['nope'] });
    expect(bad.status).toBe(400);

    const saved = await ctx
      .http()
      .put(`${API}/notifications/settings`)
      .set(bearer(session.accessToken))
      .send({ email: true, muted: ['leave'] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.muted).toEqual(['leave']);
    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'leave.request', title: 'Another request' });
    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'engagement.announcement', title: 'Now emailed' });
    await settle();
    expect(sentTo(to).map((m) => m.subject)).toEqual([expect.any(String), expect.any(String), expect.stringContaining('Now emailed')]);

    await ctx.http().put(`${API}/notifications/settings`).set(bearer(session.accessToken)).send({ email: false, muted: [] });
    await notifications.notify(org.admin.id, { organizationId: orgId, type: 'payroll.payslip', title: 'Your payslip is ready' });
    await settle();
    expect(sentTo(to)).toHaveLength(3);
    // The in-app notification is still there.
    const list = await ctx.http().get(`${API}/notifications`).set(bearer(session.accessToken));
    expect(list.body.data.some((n: { title: string }) => n.title === 'Your payslip is ready')).toBe(true);
  });
});
