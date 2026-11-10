import { AuditLog, Employee } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Organization structure & employees (e2e)', () => {
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

  async function adminSession() {
    const org = await createOrgWithAdmin(ctx);
    const s = await login(ctx, org.admin.email);
    return { ...org, h: bearer(s.accessToken) };
  }

  /** Creates a user with roles plus a linked employee record; returns the session headers and the employee. */
  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2025-01-06', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  it('manages departments, designations and locations', async () => {
    const { organization, h } = await adminSession();
    const eng = await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering', code: 'eng' });
    expect(eng.status).toBe(201);
    expect(eng.body.data.code).toBe('ENG');
    const platform = await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Platform', parentId: eng.body.data.id });
    expect(platform.status).toBe(201);

    const dup = await ctx.http().post(`${API}/departments`).set(h).send({ name: 'engineering' });
    expect(dup.status).toBe(422);
    expect(dup.body.error.details[0]).toMatchObject({ field: 'name' });
    const cycle = await ctx.http().patch(`${API}/departments/${eng.body.data.id}`).set(h).send({ parentId: platform.body.data.id });
    expect(cycle.status).toBe(422);

    expect((await ctx.http().post(`${API}/designations`).set(h).send({ name: 'Engineer', level: 3 })).status).toBe(201);
    expect((await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Bengaluru HQ', country: 'in', timezone: 'Asia/Kolkata' })).body.data.country).toBe('IN');
    expect((await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Mars', timezone: 'Mars/Base' })).status).toBe(422);

    await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2025-02-03', departmentId: platform.body.data.id });
    expect((await ctx.http().delete(`${API}/departments/${platform.body.data.id}`).set(h)).status).toBe(409);
    expect((await ctx.http().delete(`${API}/departments/${eng.body.data.id}`).set(h)).status).toBe(409);

    const list = await ctx.http().get(`${API}/departments`).set(h);
    expect(list.body.data.find((d: { name: string }) => d.name === 'Platform')).toMatchObject({ parentName: 'Engineering', employeeCount: 1 });

    // Any member can read the structure; only managers of the structure can change it.
    const employee = await person(organization.id, h, ['employee']);
    expect((await ctx.http().get(`${API}/departments`).set(employee.h)).status).toBe(200);
    expect((await ctx.http().post(`${API}/departments`).set(employee.h).send({ name: 'Sneaky' })).status).toBe(403);
  });

  it('creates employees with generated codes, history and a linked account', async () => {
    const { organization, h } = await adminSession();
    const a = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2025-02-03' });
    const b = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Bala', lastName: 'K', dateOfJoining: '2025-03-03' });
    expect([a.body.data.employeeCode, b.body.data.employeeCode]).toEqual(['EMP-0001', 'EMP-0002']);
    expect((await ctx.http().post(`${API}/employees`).set(h).send({ employeeCode: 'emp-0001', firstName: 'X', lastName: 'Y', dateOfJoining: '2025-02-03' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'X', lastName: 'Y', dateOfJoining: '2025-02-03', dateOfBirth: '2030-01-01' })).status).toBe(422);

    const history = await ctx.http().get(`${API}/employees/${a.body.data.id}/history`).set(h);
    expect(history.body.data.map((e: { type: string }) => e.type)).toEqual(['JOINED']);

    const user = await createUser(ctx, { email: uniqueEmail('linked') });
    const membership = await addMember(ctx, organization.id, user.id, ['employee']);
    const linkable = await ctx.http().get(`${API}/employees/linkable-members`).set(h);
    expect(linkable.body.data.map((m: { membershipId: string }) => m.membershipId)).toContain(membership.id);
    const linked = await ctx.http().patch(`${API}/employees/${b.body.data.id}`).set(h).send({ membershipId: membership.id });
    expect(linked.body.data.account).toMatchObject({ membershipId: membership.id, email: user.email });
    expect((await ctx.http().patch(`${API}/employees/${a.body.data.id}`).set(h).send({ membershipId: membership.id })).status).toBe(422);

    const userHeaders = bearer((await login(ctx, user.email)).accessToken);
    const me = await ctx.http().get(`${API}/employees/me`).set(userHeaders);
    expect(me.body.data).toMatchObject({ id: b.body.data.id, employeeCode: 'EMP-0002' });
  });

  it('creates employee records for existing users in one step', async () => {
    const { organization, membership: adminMembership, h } = await adminSession();
    const users = await Promise.all([createUser(ctx, { email: uniqueEmail('a'), firstName: 'Anu', lastName: 'Shah' }), createUser(ctx, { email: uniqueEmail('b'), firstName: 'Ben', lastName: 'Roy' })]);
    const members = await Promise.all(users.map((u) => addMember(ctx, organization.id, u.id, ['employee'])));

    const linkable = (await ctx.http().get(`${API}/employees/linkable-members`).set(h)).body.data;
    expect(linkable.find((m: { membershipId: string }) => m.membershipId === members[0]!.id)).toMatchObject({ firstName: 'Anu', roles: ['Employee'] });

    const res = await ctx.http().post(`${API}/employees/from-members`).set(h).send({ membershipIds: members.map((m) => m.id) });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(2);
    expect(res.body.data.employees.map((e: { employeeCode: string }) => e.employeeCode).sort()).toEqual(['EMP-0001', 'EMP-0002']);
    const anu = (await ctx.http().get(`${API}/employees?search=Anu`).set(h)).body.data[0];
    expect(anu).toMatchObject({ fullName: 'Anu Shah', workEmail: users[0]!.email, account: { membershipId: members[0]!.id } });

    expect((await ctx.http().post(`${API}/employees/from-members`).set(h).send({ membershipIds: [members[0]!.id] })).status).toBe(422);
    const user = (await ctx.http().get(`${API}/users/${members[1]!.id}`).set(h)).body.data;
    expect(user.employee).toMatchObject({ employeeCode: expect.stringMatching(/^EMP-/) });
    expect((await ctx.http().get(`${API}/users/${adminMembership.id}`).set(h)).body.data.employee).toBeNull();
  });

  it('limits employee visibility to the caller’s scope', async () => {
    const { organization, h } = await adminSession();
    const dept = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Sales' })).body.data;
    const lead = await person(organization.id, h, ['team_lead'], { departmentId: dept.id });
    const report = await person(organization.id, h, ['employee'], { managerId: lead.employee.id, departmentId: dept.id });
    const other = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Out', lastName: 'Sider', dateOfJoining: '2025-01-06' })).body.data;

    // Team Lead: TEAM scope → self + direct reports.
    const teamList = await ctx.http().get(`${API}/employees`).set(lead.h);
    expect(teamList.body.data.map((e: { id: string }) => e.id).sort()).toEqual([lead.employee.id, report.employee.id].sort());
    expect((await ctx.http().get(`${API}/employees/${other.id}`).set(lead.h)).status).toBe(404);
    const leadView = await ctx.http().get(`${API}/employees/${lead.employee.id}`).set(lead.h);
    expect(leadView.body.data.directReports.map((r: { id: string }) => r.id)).toEqual([report.employee.id]);

    // Employee: OWN scope → only themselves; no edits to their manager's record.
    const ownList = await ctx.http().get(`${API}/employees`).set(report.h);
    expect(ownList.body.data.map((e: { id: string }) => e.id)).toEqual([report.employee.id]);
    expect((await ctx.http().get(`${API}/employees/${lead.employee.id}`).set(report.h)).status).toBe(404);
    expect((await ctx.http().patch(`${API}/employees/${report.employee.id}`).set(report.h).send({ firstName: 'Hacked' })).status).toBe(403);

    // Self-service: only contact fields; anything else is rejected.
    expect((await ctx.http().patch(`${API}/employees/me`).set(report.h).send({ firstName: 'Renamed' })).status).toBe(422);
    const self = await ctx.http().patch(`${API}/employees/me`).set(report.h).send({ phone: '+91 98765 43210', emergencyContactName: 'Mom' });
    expect(self.status).toBe(200);
    expect(self.body.data).toMatchObject({ phone: '+91 98765 43210', emergencyContactName: 'Mom', firstName: report.employee.firstName });
  });

  it('records lifecycle changes and prevents reporting loops', async () => {
    const { h } = await adminSession();
    const designation = (await ctx.http().post(`${API}/designations`).set(h).send({ name: 'Senior Engineer' })).body.data;
    const boss = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Big', lastName: 'Boss', dateOfJoining: '2024-01-01' })).body.data;
    const mid = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Mid', lastName: 'Level', dateOfJoining: '2024-02-01', managerId: boss.id })).body.data;

    const promoted = await ctx.http().post(`${API}/employees/${mid.id}/lifecycle`).set(h).send({ type: 'PROMOTION', effectiveDate: '2025-04-01', designationId: designation.id, note: 'Annual cycle' });
    expect(promoted.status).toBe(201);
    expect(promoted.body.data.designation).toMatchObject({ name: 'Senior Engineer' });

    const loop = await ctx.http().post(`${API}/employees/${boss.id}/lifecycle`).set(h).send({ type: 'MANAGER_CHANGE', effectiveDate: '2025-04-01', managerId: mid.id });
    expect(loop.status).toBe(422);
    expect(loop.body.error.details[0].message).toContain('reporting loop');
    const future = await ctx.http().post(`${API}/employees/${mid.id}/lifecycle`).set(h).send({ type: 'STATUS_CHANGE', effectiveDate: '2999-01-01', status: 'EXITED' });
    expect(future.status).toBe(422);

    const exited = await ctx.http().post(`${API}/employees/${mid.id}/lifecycle`).set(h).send({ type: 'STATUS_CHANGE', effectiveDate: '2025-05-31', status: 'EXITED' });
    expect(exited.body.data).toMatchObject({ status: 'EXITED', exitDate: '2025-05-31' });

    const history = (await ctx.http().get(`${API}/employees/${mid.id}/history`).set(h)).body.data;
    expect(history.map((e: { type: string }) => e.type)).toEqual(['STATUS_CHANGE', 'PROMOTION', 'JOINED']);
    expect(history[1].changes.designationId).toEqual({ from: null, to: 'Senior Engineer' });
  });

  it('encrypts bank and statutory details and audits access without values', async () => {
    const { organization, h } = await adminSession();
    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2025-02-03' })).body.data;
    expect((await ctx.http().put(`${API}/employees/${e.id}/sensitive`).set(h).send({ pan: 'abcde1234', bankIfsc: 'nope' })).status).toBe(422);
    const saved = await ctx.http().put(`${API}/employees/${e.id}/sensitive`).set(h).send({ pan: 'abcde1234f', bankAccountNumber: '1234 5678 9012', bankIfsc: 'hdfc0001234', bankName: 'HDFC Bank' });
    expect(saved.body.data).toMatchObject({ pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' });

    const row = await Employee.findByPk(e.id, RAW);
    expect(row!.panEncrypted).toMatch(/^k1:/);
    expect(row!.panEncrypted).not.toContain('ABCDE');
    expect(row!.bankAccountLast4).toBe('9012');
    expect((await ctx.http().get(`${API}/employees/${e.id}`).set(h)).body.data.hasBankAccount).toBe(true);

    const audit = await AuditLog.findAll({ where: { organizationId: organization.id, entityId: e.id }, ...RAW });
    expect(JSON.stringify(audit)).not.toContain('ABCDE1234F');
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['employee.sensitive_updated', 'employee.sensitive_viewed']));

    const lead = await person(organization.id, h, ['team_lead']);
    expect((await ctx.http().get(`${API}/employees/${lead.employee.id}/sensitive`).set(lead.h)).status).toBe(403);
  });

  it('exports CSV within scope and neutralises spreadsheet formulas', async () => {
    const { h } = await adminSession();
    await ctx.http().post(`${API}/employees`).set(h).send({ firstName: '=HYPERLINK("x")', lastName: 'Rao', dateOfJoining: '2025-02-03' });
    const csv = await ctx.http().get(`${API}/employees/export`).set(h).buffer(true);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('keeps structure and employees isolated between organizations', async () => {
    const a = await adminSession();
    const b = await adminSession();
    const deptA = (await ctx.http().post(`${API}/departments`).set(a.h).send({ name: 'Finance' })).body.data;
    const empA = (await ctx.http().post(`${API}/employees`).set(a.h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: '2025-02-03' })).body.data;

    const cross = await ctx.http().post(`${API}/employees`).set(b.h).send({ firstName: 'B', lastName: 'B', dateOfJoining: '2025-02-03', departmentId: deptA.id, managerId: empA.id });
    expect(cross.status).toBe(422);
    expect((await ctx.http().get(`${API}/employees/${empA.id}`).set(b.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/departments`).set(b.h)).body.data).toEqual([]);
    // Codes are unique per organization, not globally.
    expect((await ctx.http().post(`${API}/employees`).set(b.h).send({ firstName: 'B', lastName: 'B', dateOfJoining: '2025-02-03' })).body.data.employeeCode).toBe('EMP-0001');
  });
});
