import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Report builder (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], firstName: string, extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema', { departmentId: ops.id });
    const manager = await person(org.organization.id, h, ['department_manager'], 'Manoj', { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id, managerId: manager.employee.id, dateOfJoining: '2021-03-01' });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { departmentId: eng.id, managerId: manager.employee.id, employmentType: 'CONTRACT' });
    await ctx.http().post(`${API}/custom-fields`).set(hr.h).send({ key: 'shirt', label: 'T-shirt size', type: 'SELECT', options: ['S', 'M', 'L'] });
    await ctx.http().put(`${API}/employees/${asha.employee.id}/custom-fields`).set(hr.h).send({ values: { shirt: 'M' } });
    await ctx.http().put(`${API}/employees/${ben.employee.id}/custom-fields`).set(hr.h).send({ values: { shirt: 'L' } });
    return { org, h, eng, ops, hr, manager, asha, ben };
  }

  const run = (h: Record<string, string>, body: Record<string, unknown>) => ctx.http().post(`${API}/reports/builder/run`).set(h).send(body);

  it('builds, scopes, summarizes, exports and saves reports', async () => {
    const s = await setup();
    const catalog = (await ctx.http().get(`${API}/reports/builder/datasets`).set(s.hr.h)).body.data as { key: string; columns: { key: string }[]; dated: unknown }[];
    expect(catalog.map((d) => d.key)).toEqual(expect.arrayContaining(['employees', 'leave_requests', 'attendance']));
    expect(catalog.find((d) => d.key === 'employees')!.columns.map((c) => c.key)).toContain('cf.shirt');
    expect((await ctx.http().get(`${API}/reports/builder/datasets`).set(s.asha.h)).status).toBe(403);

    // HR sees everyone; filters, custom fields and sorting.
    const engineers = (await run(s.hr.h, { dataset: 'employees', columns: ['employee', 'department', 'employmentType', 'cf.shirt', 'tenureYears'], filters: [{ column: 'department', op: 'eq', value: 'engineering' }], sort: { column: 'employee', direction: 'asc' } })).body.data;
    expect(engineers.rows.map((r: { employee: string }) => r.employee)).toEqual(['Asha Person', 'Ben Person', 'Manoj Person']);
    expect(engineers.rows[0]).toMatchObject({ department: 'Engineering', 'cf.shirt': 'M' });
    expect(engineers.rows[0].tenureYears).toBeGreaterThan(5);
    expect(engineers).toMatchObject({ total: 3, truncated: false });
    const contractors = (await run(s.hr.h, { dataset: 'employees', columns: ['employee'], filters: [{ column: 'employmentType', op: 'in', value: ['CONTRACT', 'INTERN'] }] })).body.data;
    expect(contractors.rows).toEqual([{ employee: 'Ben Person' }]);

    // Summary by department.
    const byDept = (await run(s.hr.h, { dataset: 'employees', columns: ['department', 'tenureYears'], groupBy: 'department' })).body.data;
    expect(byDept.columns.map((c: { key: string }) => c.key)).toEqual(['department', 'count', 'tenureYears']);
    expect(byDept.rows.find((r: { department: string }) => r.department === 'Engineering')).toMatchObject({ count: 3 });

    // The manager sees only their department.
    const mine = (await run(s.manager.h, { dataset: 'employees', columns: ['employee', 'department'] })).body.data;
    expect(new Set(mine.rows.map((r: { department: string }) => r.department))).toEqual(new Set(['Engineering']));

    // Validation: unknown columns, and dated datasets need a period.
    expect((await run(s.hr.h, { dataset: 'employees', columns: ['salary'] })).status).toBe(422);
    expect((await run(s.hr.h, { dataset: 'leave_requests', columns: ['employee'] })).status).toBe(422);
    expect((await run(s.hr.h, { dataset: 'attendance', columns: ['employee'], from: '2026-01-01', to: '2026-12-31' })).status).toBe(422);
    expect((await run(s.hr.h, { dataset: 'payslips', columns: ['employee'], from: '2026-01-01', to: '2026-03-31' })).status).toBe(403);
    expect((await run(s.hr.h, { dataset: 'leave_requests', columns: ['employee', 'leaveType', 'days'], from: '2026-01-01', to: '2026-12-31' })).body.data).toMatchObject({ total: 0 });

    // Export (needs reports.export).
    const body = { dataset: 'employees', columns: ['employeeCode', 'employee', 'cf.shirt'], filters: [{ column: 'cf.shirt', op: 'not_empty' }], sort: { column: 'employee', direction: 'asc' }, title: 'Swag sizes' };
    const csv = await ctx.http().post(`${API}/reports/builder/export`).set(s.hr.h).send(body);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/swag-sizes\.csv/);
    expect(csv.text).toContain('Employee code,Employee,T-shirt size');
    expect(csv.text).toContain('Asha Person,M');
    const xlsx = await ctx.http().post(`${API}/reports/builder/export`).set(s.hr.h).send({ ...body, format: 'xlsx' }).buffer(true);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect((await ctx.http().post(`${API}/reports/builder/export`).set(s.manager.h).send(body)).status).toBe(403);

    // Saved and shared reports: each person runs them within their own access.
    const query = { dataset: 'employees', columns: ['employee', 'department'], sort: { column: 'employee', direction: 'asc' } };
    expect((await ctx.http().post(`${API}/reports/saved`).set(s.hr.h).send({ name: 'Broken', query: { ...query, columns: ['nope'] } })).status).toBe(422);
    const saved = (await ctx.http().post(`${API}/reports/saved`).set(s.hr.h).send({ name: 'Everyone by name', shared: true, query })).body.data;
    expect(saved).toEqual([expect.objectContaining({ name: 'Everyone by name', mine: true, shared: true, dataset: 'employees' })]);
    const theirs = (await ctx.http().get(`${API}/reports/saved`).set(s.manager.h)).body.data;
    expect(theirs).toEqual([expect.objectContaining({ name: 'Everyone by name', mine: false, owner: `Hema ${s.hr.user.lastName}` })]);
    expect((await ctx.http().delete(`${API}/reports/saved/${saved[0].id}`).set(s.manager.h)).status).toBe(404);
    await ctx.http().put(`${API}/reports/saved/${saved[0].id}`).set(s.hr.h).send({ name: 'Everyone', shared: false, query });
    expect((await ctx.http().get(`${API}/reports/saved`).set(s.manager.h)).body.data).toEqual([]);
    expect((await ctx.http().delete(`${API}/reports/saved/${saved[0].id}`).set(s.hr.h)).status).toBe(200);
  });
});
