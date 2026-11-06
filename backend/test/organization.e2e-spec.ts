import sharp from 'sharp';
import { AuditLog, Notification } from '../src/database/models';
import { API, PASSWORD, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Organization settings & registration (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('reads and updates the organization profile with validation and audit', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const h = bearer(s.accessToken);

    expect((await ctx.http().get(`${API}/organizations/current`).set(h)).body.data.timezone).toBe('Asia/Kolkata');

    const invalid = await ctx.http().patch(`${API}/organizations/current`).set(h).send({ timezone: 'Mars/Base', currency: 'rupees', fiscalYearStartMonth: 13 });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(['currency', 'fiscalYearStartMonth', 'timezone']);

    const ok = await ctx.http().patch(`${API}/organizations/current`).set(h).send({ legalName: 'Org Pvt Ltd', city: 'Bengaluru', timezone: 'Asia/Dubai', website: '' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ legalName: 'Org Pvt Ltd', city: 'Bengaluru', timezone: 'Asia/Dubai', website: null });

    const audit = await AuditLog.findOne({ where: { action: 'organization.updated' }, rejectOnEmpty: true, ...RAW });
    expect(audit.changes).toMatchObject({ timezone: { from: 'Asia/Kolkata', to: 'Asia/Dubai' } });
  });

  it('restricts profile updates to permitted roles', async () => {
    const { organization } = await createOrgWithAdmin(ctx);
    const auditor = await createUser(ctx, { email: uniqueEmail('auditor') });
    await addMember(ctx, organization.id, auditor.id, ['auditor']);
    const s = await login(ctx, auditor.email);
    expect((await ctx.http().get(`${API}/organizations/current`).set(bearer(s.accessToken))).status).toBe(200);
    expect((await ctx.http().patch(`${API}/organizations/current`).set(bearer(s.accessToken)).send({ city: 'X' })).status).toBe(403);
  });

  it('uploads, serves, replaces and removes the organization logo', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    // 1×1 transparent PNG.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

    const notImage = await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'logo.png');
    expect(notImage.status).toBe(422);
    expect(notImage.body.error.details[0]).toMatchObject({ field: 'file', message: 'Upload a PNG, JPG or WebP image' });
    const tooBig = await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]), 'big.png');
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.details[0].message).toBe('The logo must be 5 MB or smaller');
    const corrupt = await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', Buffer.concat([png.subarray(0, 16), Buffer.from('garbage')]), 'broken.png');
    expect(corrupt.status).toBe(422);
    expect(corrupt.body.error.details[0].message).toContain('could not be read');

    const uploaded = await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', png, 'logo.png');
    expect(uploaded.status).toBe(201);
    const logoUrl: string = uploaded.body.data.logoUrl;
    expect(logoUrl).toMatch(new RegExp(`^/organizations/${organization.id}/logo\\?v=[0-9a-f]{16}$`));
    expect((await ctx.http().get(`${API}/organizations/current`).set(h)).body.data.logoUrl).toBe(logoUrl);

    // Public (no token), re-encoded as WebP, cacheable and locked down.
    const served = await ctx.http().get(`${API}${logoUrl}`).buffer(true);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toContain('immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect((await sharp(served.body as Buffer).metadata()).format).toBe('webp');
    expect((await ctx.http().get(`${API}${logoUrl}`).set('If-None-Match', served.headers.etag)).status).toBe(304);

    // The profile endpoint no longer accepts arbitrary logo URLs.
    await ctx.http().patch(`${API}/organizations/current`).set(h).send({ logoUrl: 'https://evil.example/x.png' });
    expect((await ctx.http().get(`${API}/organizations/current`).set(h)).body.data.logoUrl).toBe(logoUrl);

    const removed = await ctx.http().delete(`${API}/organizations/current/logo`).set(h);
    expect(removed.status).toBe(200);
    expect((await ctx.http().get(`${API}/organizations/current`).set(h)).body.data.logoUrl).toBeNull();
    expect((await ctx.http().get(`${API}/organizations/${organization.id}/logo`)).status).toBe(404);

    const actions = (await AuditLog.findAll({ where: { organizationId: organization.id }, ...RAW })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['organization.logo_updated', 'organization.logo_removed']));
  });

  it('trims empty borders and scales large logos down', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    // 3000×1200 white canvas with a 1800×400 brand block in the middle (a wide logo with lots of margin).
    const source = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: '#ffffff' } })
      .composite([{ input: await sharp({ create: { width: 1800, height: 400, channels: 3, background: '#4f46e5' } }).png().toBuffer(), left: 600, top: 400 }])
      .jpeg()
      .toBuffer();

    const uploaded = await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', source, 'brand.jpg');
    expect(uploaded.status).toBe(201);
    const served = await ctx.http().get(`${API}${uploaded.body.data.logoUrl}`).buffer(true);
    const meta = await sharp(served.body as Buffer).metadata();
    // Margins removed (aspect 4.5:1 of the brand block) and longest edge capped at 1024 px.
    expect(meta.width).toBe(1024);
    expect(Math.abs(meta.height! - Math.round(1024 / 4.5))).toBeLessThanOrEqual(3);
  });

  it('restricts logo changes to roles that can update the organization', async () => {
    const { organization } = await createOrgWithAdmin(ctx);
    const auditor = await createUser(ctx, { email: uniqueEmail('auditor') });
    await addMember(ctx, organization.id, auditor.id, ['auditor']);
    const h = bearer((await login(ctx, auditor.email)).accessToken);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    expect((await ctx.http().post(`${API}/organizations/current/logo`).set(h).attach('file', png, 'logo.png')).status).toBe(403);
    expect((await ctx.http().delete(`${API}/organizations/current/logo`).set(h)).status).toBe(403);
  });

  it('applies security policy changes to password rules', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const h = bearer(s.accessToken);

    const invalid = await ctx.http().put(`${API}/organizations/current/security-policy`).set(h).send({ sessionIdleTimeoutMinutes: 600, sessionMaxLifetimeHours: 1 });
    expect(invalid.status).toBe(422);

    const res = await ctx.http().put(`${API}/organizations/current/security-policy`).set(h).send({ passwordMinLength: 20 });
    expect(res.body.data.passwordMinLength).toBe(20);

    const change = await ctx.http().post(`${API}/auth/change-password`).set(h).send({ currentPassword: PASSWORD, newPassword: 'Short-But-Ok-123' });
    expect(change.status).toBe(422);
    expect(JSON.stringify(change.body.error.details)).toContain('at least 20 characters');

    const audit = await AuditLog.findOne({ where: { action: 'organization.security_policy_updated' }, rejectOnEmpty: true, ...RAW });
    expect(audit.changes).toMatchObject({ passwordMinLength: { from: 12, to: 20 } });
  });

  it('reports subscription and overview metrics', async () => {
    const { admin } = await createOrgWithAdmin(ctx, { planCode: 'starter' });
    const s = await login(ctx, admin.email);
    const sub = await ctx.http().get(`${API}/organizations/current/subscription`).set(bearer(s.accessToken));
    expect(sub.body.data.plan.code).toBe('starter');
    expect(sub.body.data.userCount).toBe(1);
    expect(sub.body.data.modules.find((m: { key: string }) => m.key === 'leave').entitled).toBe(true);

    const overview = await ctx.http().get(`${API}/organizations/current/overview`).set(bearer(s.accessToken));
    expect(overview.status).toBe(200);
    expect(overview.body.data.members.active).toBe(1);
    expect(overview.body.data.roles).toBe(11);
    expect(overview.body.data.loginActivity[0]).toMatchObject({ outcome: 'SUCCESS', count: 1 });
  });

  describe('self-service registration', () => {
    const payload = (email: string, password = 'Founder-Secret-2026') => ({
      organization: { name: 'Nova Systems', country: 'IN', timezone: 'Asia/Kolkata', currency: 'INR', companySize: '11-50' },
      admin: { firstName: 'Nikhil', lastName: 'Verma', email, password },
    });

    it('creates the organization, makes the registrant Organization Admin and signs them in', async () => {
      const email = uniqueEmail('founder');
      const res = await ctx.http().post(`${API}/auth/register-organization`).send(payload(email));
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('AUTHENTICATED');
      expect(res.body.data.context.activeOrganization.name).toBe('Nova Systems');
      expect(res.body.data.context.roles[0].key).toBe('org_admin');
      expect(res.body.data.context.features).toEqual(expect.arrayContaining(['core', 'employee', 'leave']));
    });

    it('rejects duplicate emails, weak passwords and invalid input', async () => {
      const email = uniqueEmail('founder');
      await ctx.http().post(`${API}/auth/register-organization`).send(payload(email));
      expect((await ctx.http().post(`${API}/auth/register-organization`).send(payload(email))).status).toBe(409);
      expect((await ctx.http().post(`${API}/auth/register-organization`).send(payload(uniqueEmail(), 'weak'))).status).toBe(422);
      const bad = await ctx.http().post(`${API}/auth/register-organization`).send({ organization: { name: '' }, admin: {} });
      expect(bad.status).toBe(422);
    });
  });

  describe('notifications', () => {
    it('lists, counts and marks notifications as read for the owner only', async () => {
      const { admin, organization } = await createOrgWithAdmin(ctx);
      const other = await createUser(ctx);
      await addMember(ctx, organization.id, other.id, ['employee']);
      await Notification.bulkCreate([
        { userId: admin.id, organizationId: organization.id, type: 'info', title: 'One' },
        { userId: admin.id, type: 'security', title: 'Two' },
        { userId: other.id, organizationId: organization.id, type: 'info', title: 'Not yours' },
      ]);
      const s = await login(ctx, admin.email);
      const h = bearer(s.accessToken);
      expect((await ctx.http().get(`${API}/notifications/unread-count`).set(h)).body.data.count).toBe(2);

      const list = await ctx.http().get(`${API}/notifications`).set(h);
      expect(list.body.data.map((n: { title: string }) => n.title).sort()).toEqual(['One', 'Two']);

      const foreign = await Notification.findOne({ where: { userId: other.id }, rejectOnEmpty: true });
      expect((await ctx.http().post(`${API}/notifications/${foreign.id}/read`).set(h)).status).toBe(404);

      await ctx.http().post(`${API}/notifications/read-all`).set(h);
      expect((await ctx.http().get(`${API}/notifications/unread-count`).set(h)).body.data.count).toBe(0);
    });
  });

  it('reports health', async () => {
    const res = await ctx.http().get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
