import { ForeignKeyConstraintError } from 'sequelize';
import { RequestContext } from '../src/common/context/request-context';
import { AuditLog, MembershipRole, OrganizationMembership, Role } from '../src/database/models';
import { TenantIsolationError } from '../src/database/tenant-scope';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Tenant isolation (e2e)', () => {
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

  async function twoOrgs() {
    const a = await createOrgWithAdmin(ctx, { name: 'Alpha Corp' });
    const b = await createOrgWithAdmin(ctx, { name: 'Beta Corp' });
    const bMember = await createUser(ctx, { email: uniqueEmail('beta') });
    const bMembership = await addMember(ctx, b.organization.id, bMember.id, ['employee']);
    return { a, b, bMembership, sa: await login(ctx, a.admin.email), sb: await login(ctx, b.admin.email) };
  }

  it('lists only the active organization\'s users and roles', async () => {
    const { a, sa } = await twoOrgs();
    const users = await ctx.http().get(`${API}/users`).set(bearer(sa.accessToken));
    expect(users.body.meta.total).toBe(1);
    expect(users.body.data[0].email).toBe(a.admin.email);

    const roles = await ctx.http().get(`${API}/roles`).set(bearer(sa.accessToken));
    const orgRoleIds = (await Role.findAll({ where: { organizationId: a.organization.id }, ...RAW })).map((r) => r.id).sort();
    expect(roles.body.data.map((r: { id: string }) => r.id).sort()).toEqual(orgRoleIds);
  });

  it('returns 404 for another organization\'s records (no existence leak)', async () => {
    const { b, bMembership, sa } = await twoOrgs();
    const bRole = b.roleIdsByKey.get('hr_manager')!;
    const h = bearer(sa.accessToken);

    expect((await ctx.http().get(`${API}/users/${bMembership.id}`).set(h)).status).toBe(404);
    expect((await ctx.http().put(`${API}/users/${bMembership.id}/roles`).set(h).send({ roleIds: [bRole] })).status).toBe(404);
    expect((await ctx.http().post(`${API}/users/${bMembership.id}/suspend`).set(h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/roles/${bRole}`).set(h)).status).toBe(404);
    expect((await ctx.http().patch(`${API}/roles/${bRole}`).set(h).send({ name: 'Hijacked' })).status).toBe(404);
    expect((await ctx.http().put(`${API}/roles/${bRole}/permissions`).set(h).send({ permissions: [] })).status).toBe(404);
    expect((await ctx.http().delete(`${API}/roles/${bRole}`).set(h)).status).toBe(404);

    const untouched = await Role.findByPk(bRole, { rejectOnEmpty: true, ...RAW });
    expect(untouched.name).toBe('HR Manager');
    expect((await OrganizationMembership.findByPk(bMembership.id, { rejectOnEmpty: true, ...RAW })).status).toBe('ACTIVE');
  });

  it('rejects assigning another organization\'s role', async () => {
    const { a, b, sa } = await twoOrgs();
    const res = await ctx.http().post(`${API}/users/invitations`).set(bearer(sa.accessToken)).send({
      email: uniqueEmail(), firstName: 'X', lastName: 'Y', roleIds: [b.roleIdsByKey.get('employee')],
    });
    expect(res.status).toBe(422);
    expect(await OrganizationMembership.count({ where: { organizationId: a.organization.id }, ...RAW })).toBe(1);
  });

  it('never trusts a client-supplied organization id without membership', async () => {
    const { a, b, sa } = await twoOrgs();
    const loginRes = await ctx.http().post(`${API}/auth/login`).send({ email: a.admin.email, password: 'Correct-Horse-Battery-9', organizationId: b.organization.id });
    expect(loginRes.status).toBe(403);

    const switchRes = await ctx.http().post(`${API}/auth/switch-organization`).set(bearer(sa.accessToken)).send({ organizationId: b.organization.id });
    expect(switchRes.status).toBe(403);
  });

  it('switches organizations for multi-org users and invalidates the old org-bound token', async () => {
    const { a, b, bMembership } = await twoOrgs();
    await addMember(ctx, b.organization.id, a.admin.id, ['auditor']);
    const s = await login(ctx, a.admin.email, undefined, a.organization.id);
    expect(s.body.data.context.organizations).toHaveLength(2);

    const switched = await ctx.http().post(`${API}/auth/switch-organization`).set(bearer(s.accessToken)).send({ organizationId: b.organization.id });
    expect(switched.status).toBe(200);
    expect(switched.body.data.context.activeOrganization.id).toBe(b.organization.id);
    expect(switched.body.data.context.roles.map((r: { key: string }) => r.key)).toEqual(['auditor']);

    const usersInB = await ctx.http().get(`${API}/users`).set(bearer(switched.body.data.accessToken));
    expect(usersInB.body.data.map((u: { id: string }) => u.id)).toContain(bMembership.id);
    // Auditor cannot modify users in B.
    expect((await ctx.http().post(`${API}/users/${bMembership.id}/suspend`).set(bearer(switched.body.data.accessToken))).status).toBe(403);

    const stale = await ctx.http().get(`${API}/users`).set(bearer(s.accessToken));
    expect(stale.status).toBe(401);
  });

  it('scopes audit logs and login history per organization', async () => {
    const { a, b, sa, sb } = await twoOrgs();
    await ctx.http().post(`${API}/roles`).set(bearer(sb.accessToken)).send({ name: 'Beta Secret Role', permissions: [] });
    const logs = await ctx.http().get(`${API}/audit-logs`).set(bearer(sa.accessToken));
    expect(JSON.stringify(logs.body.data)).not.toContain('Beta Secret Role');

    const events = await ctx.http().get(`${API}/login-events`).set(bearer(sa.accessToken));
    const emails = new Set(events.body.data.map((e: { email: string }) => e.email));
    expect([...emails]).toEqual([a.admin.email]);
    expect(emails.has(b.admin.email)).toBe(false);
  });

  it('enforces cross-tenant integrity at the database level', async () => {
    const { a, b } = await twoOrgs();
    const aMembership = await OrganizationMembership.findOne({ where: { organizationId: a.organization.id }, rejectOnEmpty: true, ...RAW });
    await expect(
      MembershipRole.create({ organizationId: a.organization.id, membershipId: aMembership.id, roleId: b.roleIdsByKey.get('org_admin')! }, RAW),
    ).rejects.toThrow(ForeignKeyConstraintError);
  });

  it('keeps the audit trail append-only at the database level', async () => {
    const { sa } = await twoOrgs();
    await ctx.http().post(`${API}/roles`).set(bearer(sa.accessToken)).send({ name: 'Audited', permissions: [] });
    const entry = await AuditLog.findOne({ where: { action: 'role.created' }, rejectOnEmpty: true, ...RAW });
    await expect(AuditLog.update({ summary: 'tampered' }, { where: { id: entry.id }, ...RAW })).rejects.toThrow(/append-only/);
    await expect(AuditLog.destroy({ where: { id: entry.id }, ...RAW })).rejects.toThrow(/append-only/);
  });

  it('fails closed when tenant models are queried without a tenant context', async () => {
    await twoOrgs();
    await expect(Role.findAll()).rejects.toThrow(TenantIsolationError);
    await expect(OrganizationMembership.count()).rejects.toThrow(TenantIsolationError);
    await expect(Role.update({ name: 'x' }, { where: {} })).rejects.toThrow(TenantIsolationError);
    await expect(Role.destroy({ where: {} })).rejects.toThrow(TenantIsolationError);
  });

  it('auto-scopes tenant models to the context organization', async () => {
    const { a, b } = await twoOrgs();
    const roles = await RequestContext.runForTenant(a.organization.id, () => Role.findAll());
    expect(roles).toHaveLength(11);
    expect(roles.every((r) => r.organizationId === a.organization.id)).toBe(true);

    // A filter on another organization can only narrow, never widen.
    const foreign = await RequestContext.runForTenant(a.organization.id, () => Role.findAll({ where: { organizationId: b.organization.id } }));
    expect(foreign).toHaveLength(0);
    const byPk = await RequestContext.runForTenant(a.organization.id, () => Role.findByPk(b.roleIdsByKey.get('employee')!));
    expect(byPk).toBeNull();
  });

  it('rejects cross-tenant writes through the tenant hooks', async () => {
    const { a, b } = await twoOrgs();
    await expect(
      RequestContext.runForTenant(a.organization.id, () => Role.create({ organizationId: b.organization.id, key: 'intruder', name: 'Intruder' })),
    ).rejects.toThrow(TenantIsolationError);
    const [updated] = await RequestContext.runForTenant(a.organization.id, () =>
      Role.update({ name: 'Hijacked' }, { where: { id: b.roleIdsByKey.get('employee')! } }),
    );
    expect(updated).toBe(0);
    const role = await RequestContext.runForTenant(a.organization.id, () => Role.findOne({ where: { key: 'employee' }, rejectOnEmpty: true }));
    role.organizationId = b.organization.id;
    await expect(RequestContext.runForTenant(a.organization.id, () => role.save())).rejects.toThrow(TenantIsolationError);
  });
});
