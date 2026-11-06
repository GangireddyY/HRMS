import { PERMISSIONS } from '../src/contracts';
import { Notification, OrganizationMembership, Plan, Role } from '../src/database/models';
import {
  API,
  PASSWORD,
  RAW,
  TestContext,
  addMember,
  bearer,
  createOrgWithAdmin,
  createTestApp,
  createUser,
  login,
  resetDatabase,
  tokenFromMail,
  uniqueEmail,
} from './helpers';

describe('RBAC & user administration (e2e)', () => {
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

  async function memberWithRoles(organizationId: string, roleKeys: string[]) {
    const user = await createUser(ctx, { email: uniqueEmail('member'), firstName: 'Kiran', lastName: 'Rao' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const session = await login(ctx, user.email);
    return { user, membership, session };
  }

  it('provisions the 11 system roles for a new organization', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const res = await ctx.http().get(`${API}/roles`).set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(11);
    const orgAdmin = res.body.data.find((r: { key: string }) => r.key === 'org_admin');
    expect(orgAdmin).toMatchObject({ isSystem: true, isLocked: true, memberCount: 1 });
  });

  it('denies employees access to administration endpoints', async () => {
    const { organization } = await createOrgWithAdmin(ctx);
    const { session } = await memberWithRoles(organization.id, ['employee']);
    for (const path of ['/users', '/roles', '/audit-logs', '/organizations/current/security-policy']) {
      const res = await ctx.http().get(`${API}${path}`).set(bearer(session.accessToken));
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }
    expect(session.body.data.context.permissions['leave.apply']).toBe('ORGANIZATION');
    expect(session.body.data.context.permissions['leave.view']).toBe('OWN');
  });

  it('applies role changes immediately without re-login', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const adminSession = await login(ctx, admin.email);
    const { membership, session } = await memberWithRoles(organization.id, ['employee']);
    expect((await ctx.http().get(`${API}/users`).set(bearer(session.accessToken))).status).toBe(403);

    const role = await ctx.http().post(`${API}/roles`).set(bearer(adminSession.accessToken)).send({
      name: 'People Viewer',
      description: 'Can see users',
      permissions: [{ key: 'user.view', scope: 'ORGANIZATION' }],
    });
    expect(role.status).toBe(201);
    expect(role.body.data.key).toBe('people_viewer');

    const employeeRole = await Role.findOne({ where: { organizationId: organization.id, key: 'employee' }, rejectOnEmpty: true, ...RAW });
    const assign = await ctx.http().put(`${API}/users/${membership.id}/roles`).set(bearer(adminSession.accessToken)).send({ roleIds: [employeeRole.id, role.body.data.id] });
    expect(assign.status).toBe(200);
    expect(assign.body.data.roles).toHaveLength(2);

    expect((await ctx.http().get(`${API}/users`).set(bearer(session.accessToken))).status).toBe(200);
    expect(await Notification.count({ where: { userId: membership.userId, type: 'access' } })).toBe(1);
  });

  it('normalises scopes of non-scopable permissions and rejects unknown permissions', async () => {
    const { admin } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const ok = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({
      name: 'Approver',
      permissions: [{ key: 'leave.approve', scope: 'TEAM' }, { key: 'leave.configure', scope: 'OWN' }],
    });
    const scopes = Object.fromEntries(ok.body.data.permissions.map((p: { key: string; scope: string }) => [p.key, p.scope]));
    expect(scopes).toEqual({ 'leave.approve': 'TEAM', 'leave.configure': 'ORGANIZATION' });

    const bad = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({ name: 'Bad', permissions: [{ key: 'payroll.steal', scope: 'OWN' }] });
    expect(bad.status).toBe(422);
  });

  it('prevents privilege escalation through roles and invitations', async () => {
    const { admin, organization, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const adminSession = await login(ctx, admin.email);
    const delegate = await ctx.http().post(`${API}/roles`).set(bearer(adminSession.accessToken)).send({
      name: 'User Coordinator',
      permissions: ['user.view', 'user.invite', 'user.update', 'role.view'].map((key) => ({ key, scope: 'ORGANIZATION' })),
    });
    expect(delegate.status).toBe(201);
    const { session } = await memberWithRoles(organization.id, [delegate.body.data.key]);

    const invite = await ctx.http().post(`${API}/users/invitations`).set(bearer(session.accessToken)).send({
      email: uniqueEmail('new'), firstName: 'New', lastName: 'Person', roleIds: [roleIdsByKey.get('org_admin')],
    });
    expect(invite.status).toBe(403);

    const target = await memberWithRoles(organization.id, ['employee']);
    const promote = await ctx.http().put(`${API}/users/${target.membership.id}/roles`).set(bearer(session.accessToken)).send({ roleIds: [roleIdsByKey.get('hr_manager')] });
    expect(promote.status).toBe(403);

    // Cannot act on someone more privileged (the org admin).
    const adminMembership = await OrganizationMembership.findOne({ where: { userId: admin.id }, rejectOnEmpty: true, ...RAW });
    expect((await ctx.http().post(`${API}/users/${adminMembership.id}/suspend`).set(bearer(session.accessToken))).status).toBe(403);
  });

  it('protects locked and system roles', async () => {
    const { admin, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const locked = await ctx.http().put(`${API}/roles/${roleIdsByKey.get('org_admin')}/permissions`).set(bearer(s.accessToken)).send({ permissions: [] });
    expect(locked.status).toBe(403);
    const del = await ctx.http().delete(`${API}/roles/${roleIdsByKey.get('employee')}`).set(bearer(s.accessToken));
    expect(del.status).toBe(403);

    const employee = roleIdsByKey.get('employee')!;
    const rename = await ctx.http().patch(`${API}/roles/${employee}`).set(bearer(s.accessToken)).send({ name: 'Staff' });
    expect(rename.status).toBe(403);
    const described = await ctx.http().patch(`${API}/roles/${employee}`).set(bearer(s.accessToken)).send({ description: 'Everyone in the company' });
    expect(described.status).toBe(200);
    expect(described.body.data).toMatchObject({ name: 'Employee', description: 'Everyone in the company' });

    const custom = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({ name: 'Approvers', permissions: [] });
    const renamed = await ctx.http().patch(`${API}/roles/${custom.body.data.id}`).set(bearer(s.accessToken)).send({ name: 'Leave Approvers' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Leave Approvers');
  });

  it('edits system role permissions and blocks deleting roles in use', async () => {
    const { admin, organization, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const teamLead = roleIdsByKey.get('team_lead')!;
    const update = await ctx.http().put(`${API}/roles/${teamLead}/permissions`).set(bearer(s.accessToken)).send({
      permissions: [{ key: 'leave.view', scope: 'TEAM' }, { key: 'leave.approve', scope: 'TEAM' }],
    });
    expect(update.status).toBe(200);
    expect(update.body.data.permissions).toHaveLength(2);

    const custom = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({ name: 'Temp', permissions: [] });
    await memberWithRoles(organization.id, ['temp']);
    expect((await ctx.http().delete(`${API}/roles/${custom.body.data.id}`).set(bearer(s.accessToken))).status).toBe(409);

    const unused = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({ name: 'Unused', permissions: [] });
    expect((await ctx.http().delete(`${API}/roles/${unused.body.data.id}`).set(bearer(s.accessToken))).status).toBe(200);

    const audit = await ctx.http().get(`${API}/audit-logs?action=role.`).set(bearer(s.accessToken));
    const actions = audit.body.data.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['role.permissions_updated', 'role.created', 'role.deleted']));
  });

  it('keeps at least one active Organization Admin', async () => {
    const { admin, organization, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const adminSession = await login(ctx, admin.email);
    const adminMembership = await OrganizationMembership.findOne({ where: { userId: admin.id }, rejectOnEmpty: true, ...RAW });

    expect((await ctx.http().post(`${API}/users/${adminMembership.id}/suspend`).set(bearer(adminSession.accessToken))).status).toBe(403);
    const selfDemote = await ctx.http().put(`${API}/users/${adminMembership.id}/roles`).set(bearer(adminSession.accessToken)).send({ roleIds: [roleIdsByKey.get('employee')] });
    expect(selfDemote.status).toBe(403);

    // A non-admin holding every permission still cannot remove the last admin.
    const everything = await ctx.http().post(`${API}/roles`).set(bearer(adminSession.accessToken)).send({
      name: 'All Access',
      permissions: PERMISSIONS.filter((p) => !p.restricted).map((p) => ({ key: p.key, scope: 'ORGANIZATION' })),
    });
    expect(everything.status).toBe(201);
    const { session } = await memberWithRoles(organization.id, ['all_access']);
    const res = await ctx.http().post(`${API}/users/${adminMembership.id}/suspend`).set(bearer(session.accessToken));
    expect(res.status).toBe(409);
  });

  it('suspension blocks access immediately and reactivation restores it', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    const adminSession = await login(ctx, admin.email);
    const { membership, session, user } = await memberWithRoles(organization.id, ['employee']);

    const suspend = await ctx.http().post(`${API}/users/${membership.id}/suspend`).set(bearer(adminSession.accessToken));
    expect(suspend.body.data.status).toBe('SUSPENDED');
    expect((await ctx.http().get(`${API}/auth/me`).set(bearer(session.accessToken))).status).toBe(401);
    expect((await ctx.http().post(`${API}/auth/login`).send({ email: user.email, password: PASSWORD })).status).toBe(403);

    const reactivate = await ctx.http().post(`${API}/users/${membership.id}/reactivate`).set(bearer(adminSession.accessToken));
    expect(reactivate.body.data.status).toBe('ACTIVE');
    await login(ctx, user.email);
  });

  it('invites a new user who accepts and signs in', async () => {
    const { admin, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const email = uniqueEmail('invitee');

    const invite = await ctx.http().post(`${API}/users/invitations`).set(bearer(s.accessToken)).send({
      email, firstName: 'Meera', lastName: 'Nair', roleIds: [roleIdsByKey.get('employee')],
    });
    expect(invite.status).toBe(201);
    expect(invite.body.data.status).toBe('INVITED');

    const duplicate = await ctx.http().post(`${API}/users/invitations`).set(bearer(s.accessToken)).send({
      email, firstName: 'Meera', lastName: 'Nair', roleIds: [roleIdsByKey.get('employee')],
    });
    expect(duplicate.status).toBe(409);

    const token = tokenFromMail(ctx, email);
    const inspect = await ctx.http().post(`${API}/auth/tokens/inspect`).send({ token, purpose: 'INVITATION' });
    expect(inspect.body.data).toMatchObject({ email, existingAccount: false });

    const accept = await ctx.http().post(`${API}/auth/accept-invitation`).send({ token, password: PASSWORD });
    expect(accept.status).toBe(200);
    const session = await login(ctx, email);
    expect(session.body.data.context.roles[0].key).toBe('employee');

    expect((await ctx.http().post(`${API}/auth/accept-invitation`).send({ token, password: PASSWORD })).status).toBe(400);
  });

  it('lets an existing account join another organization by confirming its password', async () => {
    const orgA = await createOrgWithAdmin(ctx);
    const orgB = await createOrgWithAdmin(ctx);
    const sB = await login(ctx, orgB.admin.email);

    const invite = await ctx.http().post(`${API}/users/invitations`).set(bearer(sB.accessToken)).send({
      email: orgA.admin.email, firstName: 'x', lastName: 'y', roleIds: [orgB.roleIdsByKey.get('auditor')],
    });
    expect(invite.status).toBe(201);
    const token = tokenFromMail(ctx, orgA.admin.email);
    expect((await ctx.http().post(`${API}/auth/accept-invitation`).send({ token, password: 'Wrong-Password-1' })).status).toBe(401);
    expect((await ctx.http().post(`${API}/auth/accept-invitation`).send({ token, password: PASSWORD })).status).toBe(200);

    const s = await login(ctx, orgA.admin.email);
    expect(s.body.data.context.organizations).toHaveLength(2);
  });

  it('cancels and resends invitations', async () => {
    const { admin, roleIdsByKey } = await createOrgWithAdmin(ctx);
    const s = await login(ctx, admin.email);
    const email = uniqueEmail('invitee');
    const invite = await ctx.http().post(`${API}/users/invitations`).set(bearer(s.accessToken)).send({ email, firstName: 'A', lastName: 'B', roleIds: [roleIdsByKey.get('employee')] });
    const first = tokenFromMail(ctx, email);

    expect((await ctx.http().post(`${API}/users/${invite.body.data.id}/invitation/resend`).set(bearer(s.accessToken))).status).toBe(200);
    const second = tokenFromMail(ctx, email);
    expect(second).not.toBe(first);
    expect((await ctx.http().post(`${API}/auth/tokens/inspect`).send({ token: first, purpose: 'INVITATION' })).status).toBe(400);

    expect((await ctx.http().delete(`${API}/users/${invite.body.data.id}/invitation`).set(bearer(s.accessToken))).status).toBe(200);
    expect((await ctx.http().post(`${API}/auth/tokens/inspect`).send({ token: second, purpose: 'INVITATION' })).status).toBe(400);
  });

  it('enforces the plan user limit', async () => {
    const { admin, organization, roleIdsByKey } = await createOrgWithAdmin(ctx);
    await Plan.update({ maxUsers: 2 }, { where: { id: organization.planId } });
    const s = await login(ctx, admin.email);
    const invite = (email: string) =>
      ctx.http().post(`${API}/users/invitations`).set(bearer(s.accessToken)).send({ email, firstName: 'A', lastName: 'B', roleIds: [roleIdsByKey.get('employee')] });
    expect((await invite(uniqueEmail())).status).toBe(201);
    const blocked = await invite(uniqueEmail());
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toContain('up to 2 users');
  });

  it('gates permissions by subscription entitlements', async () => {
    const { admin } = await createOrgWithAdmin(ctx, { planCode: 'starter' });
    const s = await login(ctx, admin.email);
    expect(s.body.data.context.features).not.toContain('payroll');
    expect(s.body.data.context.permissions['payroll.view']).toBeUndefined();

    const catalog = await ctx.http().get(`${API}/permissions`).set(bearer(s.accessToken));
    expect(catalog.body.data.modules.find((m: { key: string }) => m.key === 'payroll').entitled).toBe(false);

    const role = await ctx.http().post(`${API}/roles`).set(bearer(s.accessToken)).send({ name: 'Payroll', permissions: [{ key: 'payroll.view', scope: 'ORGANIZATION' }] });
    expect(role.status).toBe(403);
    expect(role.body.error.code).toBe('FEATURE_NOT_ENTITLED');
  });

  it('paginates, searches and sorts users', async () => {
    const { admin, organization } = await createOrgWithAdmin(ctx);
    for (let i = 0; i < 3; i++) {
      const u = await createUser(ctx, { email: uniqueEmail(`zeta${i}`), firstName: `Zeta${i}` });
      await addMember(ctx, organization.id, u.id, ['employee']);
    }
    const s = await login(ctx, admin.email);
    const page = await ctx.http().get(`${API}/users?page=1&pageSize=2&sort=name:asc`).set(bearer(s.accessToken));
    expect(page.body.meta).toEqual({ page: 1, pageSize: 2, total: 4, totalPages: 2 });
    const search = await ctx.http().get(`${API}/users?search=zeta1`).set(bearer(s.accessToken));
    expect(search.body.meta.total).toBe(1);
    const badSort = await ctx.http().get(`${API}/users?sort=passwordHash:asc`).set(bearer(s.accessToken));
    expect(badSort.status).toBe(422);
  });
});
