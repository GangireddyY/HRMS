import { Plan, Role } from '../src/database/models';
import { PASSWORD, API, RAW, TestContext, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, tokenFromMail, totp, uniqueEmail } from './helpers';

describe('Platform administration (e2e)', () => {
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

  /** A signed-in super admin who has enrolled two-factor authentication (required for platform staff). */
  async function superAdmin() {
    const user = await createUser(ctx, { email: uniqueEmail('root'), firstName: 'Platform', lastName: 'Operator', platformRole: 'SUPER_ADMIN' });
    const s = await login(ctx, user.email);
    const setup = await ctx.http().post(`${API}/auth/mfa/setup`).set(bearer(s.accessToken));
    expect(setup.status).toBe(200);
    expect((await ctx.http().post(`${API}/auth/mfa/enable`).set(bearer(s.accessToken)).send({ code: totp(setup.body.data.secret) })).status).toBe(200);
    return s;
  }

  it('requires super admins to set up two-factor authentication before platform access', async () => {
    const user = await createUser(ctx, { email: uniqueEmail('root'), platformRole: 'SUPER_ADMIN' });
    const s = await login(ctx, user.email);
    expect(s.body.data.context.mfaSetupRequired).toBe(true);
    const blocked = await ctx.http().get(`${API}/platform/dashboard`).set(bearer(s.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    const status = await ctx.http().get(`${API}/auth/mfa`).set(bearer(s.accessToken));
    expect(status.body.data.required).toBe(true);
  });

  it('gives super admins platform access without a tenant context', async () => {
    const s = await superAdmin();
    expect(s.body.data.context.activeOrganization).toBeNull();
    expect(s.body.data.context.platformPermissions).toEqual(expect.arrayContaining(['platform.organizations.manage', 'platform.plans.manage']));
    expect((await ctx.http().get(`${API}/platform/dashboard`).set(bearer(s.accessToken))).status).toBe(200);
    // Tenant endpoints require an organization context.
    expect((await ctx.http().get(`${API}/users`).set(bearer(s.accessToken))).status).toBe(403);
  });

  it('denies platform endpoints to organization admins', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    for (const path of ['/platform/dashboard', '/platform/organizations', '/platform/plans', '/platform/audit-logs']) {
      expect((await ctx.http().get(`${API}${path}`).set(bearer(s.accessToken))).status).toBe(403);
    }
  });

  it('creates an organization and invites its first administrator', async () => {
    const s = await superAdmin();
    const plan = await Plan.findOne({ where: { code: 'growth' }, rejectOnEmpty: true });
    const email = uniqueEmail('founder');
    const res = await ctx.http().post(`${API}/platform/organizations`).set(bearer(s.accessToken)).send({
      name: 'Gamma Consulting', planId: plan.id, timezone: 'Asia/Kolkata', country: 'IN',
      admin: { email, firstName: 'Gita', lastName: 'Menon' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Gamma Consulting', slug: 'gamma-consulting', status: 'ACTIVE' });
    expect(res.body.data.admins[0]).toMatchObject({ email, status: 'INVITED' });
    expect(await Role.count({ where: { organizationId: res.body.data.id }, ...RAW })).toBe(11);

    const token = tokenFromMail(ctx, email);
    expect((await ctx.http().post(`${API}/auth/accept-invitation`).send({ token, password: PASSWORD })).status).toBe(200);
    const adminSession = await login(ctx, email);
    expect(adminSession.body.data.context.roles[0].key).toBe('org_admin');
    expect(adminSession.body.data.context.features).toContain('payroll');
    expect(adminSession.body.data.context.features).not.toContain('grievance');
  });

  it('allocates unique slugs', async () => {
    const s = await superAdmin();
    const plan = await Plan.findOne({ where: { code: 'starter' }, rejectOnEmpty: true });
    const create = () =>
      ctx.http().post(`${API}/platform/organizations`).set(bearer(s.accessToken)).send({ name: 'Delta Labs', planId: plan.id, admin: { email: uniqueEmail(), firstName: 'D', lastName: 'L' } });
    expect((await create()).body.data.slug).toBe('delta-labs');
    expect((await create()).body.data.slug).toBe('delta-labs-2');
  });

  it('suspension revokes sessions and blocks sign-in; activation restores access', async () => {
    const s = await superAdmin();
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const orgSession = await login(ctx, admin.email);

    const suspend = await ctx.http().post(`${API}/platform/organizations/${organization.id}/suspend`).set(bearer(s.accessToken)).send({ reason: 'Payment overdue' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data).toMatchObject({ status: 'SUSPENDED', suspensionReason: 'Payment overdue' });

    expect((await ctx.http().get(`${API}/auth/me`).set(bearer(orgSession.accessToken))).status).toBe(401);
    const blocked = await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_INACTIVE');

    expect((await ctx.http().post(`${API}/platform/organizations/${organization.id}/suspend`).set(bearer(s.accessToken)).send({ reason: 'again' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/platform/organizations/${organization.id}/activate`).set(bearer(s.accessToken))).status).toBe(200);
    await login(ctx, admin.email);

    const audit = await ctx.http().get(`${API}/platform/audit-logs?organizationId=${organization.id}`).set(bearer(s.accessToken));
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['platform.organization_suspended', 'platform.organization_active']));
  });

  it('manages plans and per-organization feature overrides', async () => {
    const s = await superAdmin();
    const created = await ctx.http().post(`${API}/platform/plans`).set(bearer(s.accessToken)).send({
      code: 'nonprofit', name: 'Non-profit', maxUsers: 100, monthlyPrice: 0, currency: 'INR', featureKeys: ['employee', 'leave'],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.featureKeys.sort()).toEqual(['employee', 'leave']);
    expect((await ctx.http().post(`${API}/platform/plans`).set(bearer(s.accessToken)).send({ code: 'nonprofit', name: 'Dup' })).status).toBe(409);

    const { admin, organization } = await createOrgWithAdmin(ctx, { planCode: 'starter' });
    const override = await ctx.http().put(`${API}/platform/organizations/${organization.id}/features`).set(bearer(s.accessToken)).send({
      overrides: [{ featureKey: 'payroll', enabled: true, reason: 'Pilot' }, { featureKey: 'leave', enabled: false }],
    });
    expect(override.status).toBe(200);
    const orgSession = await login(ctx, admin.email);
    expect(orgSession.body.data.context.features).toContain('payroll');
    expect(orgSession.body.data.context.features).not.toContain('leave');

    const clear = await ctx.http().put(`${API}/platform/organizations/${organization.id}/features`).set(bearer(s.accessToken)).send({ overrides: [{ featureKey: 'payroll', enabled: null }] });
    expect(clear.body.data.featureOverrides).toHaveLength(1);

    const coreOverride = await ctx.http().put(`${API}/platform/organizations/${organization.id}/features`).set(bearer(s.accessToken)).send({ overrides: [{ featureKey: 'core', enabled: false }] });
    expect(coreOverride.status).toBe(422);
  });

  it('lists organizations with filters and pagination', async () => {
    const s = await superAdmin();
    await createOrgWithAdmin(ctx, { name: 'Omega Retail' });
    await createOrgWithAdmin(ctx, { name: 'Sigma Health' });
    const res = await ctx.http().get(`${API}/platform/organizations?search=omega`).set(bearer(s.accessToken));
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ name: 'Omega Retail', userCount: 1 });
    const status = await ctx.http().get(`${API}/platform/organizations?status=SUSPENDED`).set(bearer(s.accessToken));
    expect(status.body.meta.total).toBe(0);
  });
});
