import { LeaveRequest } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const days = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
type Row = Record<string, string | number | null>;
type Table = { key: string; rows: Row[] };
const table = (body: { tables: Table[] }, key: string) => body.tables.find((t) => t.key === key)!.rows;

describe('Reports (e2e)', () => {
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
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  /** 9 employees: 4 in Operations, 5 in Engineering (one exited, one whose last day has passed), one joined 10 days ago. */
  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema', { departmentId: ops.id });
    const pm = await person(org.organization.id, h, ['payroll_manager'], 'Priya', { departmentId: ops.id });
    const fin = await person(org.organization.id, h, ['finance_manager'], 'Farah', { departmentId: ops.id });
    const rec = await person(org.organization.id, h, ['recruiter'], 'Ravi', { departmentId: ops.id });
    const mgr = await person(org.organization.id, h, ['department_manager'], 'Manoj', { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id, gender: 'FEMALE' });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { departmentId: eng.id, gender: 'MALE', dateOfJoining: days(-10) });
    const dev = await person(org.organization.id, h, ['employee'], 'Dev', { departmentId: eng.id });
    const eve = await person(org.organization.id, h, ['employee'], 'Eve', { departmentId: eng.id });
    // Dev exited five days ago (no exit case); Eve's termination had its last working day three days ago.
    expect((await ctx.http().post(`${API}/employees/${dev.employee.id}/lifecycle`).set(h).send({ type: 'STATUS_CHANGE', status: 'EXITED', effectiveDate: days(-5) })).status).toBe(201);
    expect((await ctx.http().post(`${API}/exits`).set(h).send({ employeeId: eve.employee.id, type: 'TERMINATION', reason: 'PERFORMANCE', noticeGivenOn: days(-3), lastWorkingDay: days(-3) })).status).toBe(201);
    return { org, h, eng, ops, hr, pm, fin, rec, mgr, asha, ben, dev, eve };
  }

  it('reports headcount and attrition within the caller’s scope', async () => {
    const t = await team();
    const hc = (await ctx.http().get(`${API}/reports/headcount`).set(t.hr.h)).body.data;
    expect(hc.summary).toMatchObject({ headcount: 7, onNotice: 0, joinersLast30Days: 1, womenShare: 14.3 });
    expect(table(hc, 'department')).toEqual([
      { name: 'Operations', count: 4, share: 57.1 },
      { name: 'Engineering', count: 3, share: 42.9 },
    ]);
    expect(table(hc, 'gender')).toEqual([
      { name: 'Not recorded', count: 5, share: 71.4 },
      { name: 'Female', count: 1, share: 14.3 },
      { name: 'Male', count: 1, share: 14.3 },
    ]);
    expect(hc.trend).toHaveLength(12);
    expect(hc.trend.at(-1)).toMatchObject({ headcount: 7 });

    // A department manager sees their department only; employees see no reports.
    const mine = (await ctx.http().get(`${API}/reports/headcount`).set(t.mgr.h)).body.data;
    expect(mine.summary.headcount).toBe(3);
    expect(table(mine, 'department')).toEqual([{ name: 'Engineering', count: 3, share: 100 }]);
    expect((await ctx.http().get(`${API}/reports/headcount`).set(t.asha.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/reports/headcount?asOf=${days(1)}`).set(t.hr.h)).status).toBe(422);
    // Headcount on an earlier day still counts the leavers (six days ago: everyone, including Ben who joined 10 days ago).
    expect((await ctx.http().get(`${API}/reports/headcount?asOf=${days(-6)}`).set(t.hr.h)).body.data.summary.headcount).toBe(9);

    const att = (await ctx.http().get(`${API}/reports/attrition?from=${days(-30)}&to=${days(0)}`).set(t.hr.h)).body.data;
    expect(att.summary).toEqual({ startHeadcount: 8, endHeadcount: 7, joiners: 1, leavers: 2, voluntary: 0, involuntary: 2, rate: 26.7, annualizedRate: 314 });
    expect(table(att, 'type')).toEqual([
      { name: 'Not recorded', count: 1, share: 50 },
      { name: 'Termination', count: 1, share: 50 },
    ]);
    expect(table(att, 'department')[0]).toMatchObject({ name: 'Engineering', start: 4, end: 3, joiners: 1, leavers: 2 });
    expect(table(att, 'leavers').map((r) => r.name)).toEqual(['Eve Person', 'Dev Person']);
    expect((await ctx.http().get(`${API}/reports/attrition?from=${days(0)}&to=${days(-1)}`).set(t.hr.h)).status).toBe(422);
    expect((await ctx.http().get(`${API}/reports/attrition?from=2020-01-01&to=${days(0)}`).set(t.hr.h)).status).toBe(422);

    // CSV export needs reports.export as well.
    const csv = await ctx.http().get(`${API}/reports/headcount/export`).set(t.hr.h);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('By department');
    expect(csv.text).toContain('Operations,4,57.1');
    expect((await ctx.http().get(`${API}/reports/headcount/export`).set(t.mgr.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/reports/unknown/export`).set(t.hr.h)).status).toBe(400);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/reports/headcount`).set(oh)).body.data.summary.headcount).toBe(0);
  });

  it('reports leave, payroll cost and recruitment to those allowed to see them', async () => {
    const t = await team();
    const cl = (await ctx.http().post(`${API}/leave/types`).set(t.h).send({ code: 'CL', name: 'Casual leave', accrualFrequency: 'NONE' })).body.data;
    await LeaveRequest.create({ organizationId: t.org.organization.id, employeeId: t.asha.employee.id, leaveTypeId: cl.id, leaveYear: Number(days(-7).slice(0, 4)), startDate: days(-7), endDate: days(-6), days: '2', reason: 'Family function', status: 'APPROVED' }, RAW);
    const leave = (await ctx.http().get(`${API}/reports/leave?from=${days(-30)}&to=${days(0)}`).set(t.hr.h)).body.data;
    expect(leave.summary).toMatchObject({ approvedDays: 2, requests: 1, pending: 0, peopleOnLeave: 1 });
    expect(table(leave, 'type')).toEqual([{ name: 'Casual leave', requests: 1, days: 2, pending: 0 }]);
    expect(table(leave, 'people')).toEqual([{ name: 'Asha Person', code: t.asha.employee.employeeCode, department: 'Engineering', days: 2 }]);

    // Payroll cost: an approved run.
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(t.h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    await ctx.http().post(`${API}/payroll/employees/${t.asha.employee.id}/salaries`).set(t.pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' });
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(t.pm.h).send({ year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 })).body.data;
    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(t.pm.h).send({});
    const approved = await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(t.fin.h).send({});
    expect(approved.status).toBe(201);
    const cost = (await ctx.http().get(`${API}/reports/payroll-cost`).set(t.pm.h)).body.data;
    expect(cost.summary).toMatchObject({ runs: 1, totalGross: approved.body.data.totalGross, totalNet: approved.body.data.totalNet });
    expect(cost.summary.costToCompany).toBe(Math.round((approved.body.data.totalGross + approved.body.data.totalEmployerContributions) * 100) / 100);
    expect(table(cost, 'department')).toEqual([expect.objectContaining({ name: 'Engineering', employees: 1, share: 100 })]);
    expect((await ctx.http().get(`${API}/reports/payroll-cost`).set(t.hr.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/reports/payroll-cost?fromMonth=2024-01&toMonth=2026-12`).set(t.pm.h)).status).toBe(422);

    // Recruitment: the recruiter sees it; the payroll manager can't export it.
    const recruitment = (await ctx.http().get(`${API}/reports/recruitment`).set(t.rec.h)).body.data;
    expect(recruitment.summary).toMatchObject({ applications: 0, hired: 0, conversion: null, medianDaysToHire: null });
    expect((await ctx.http().get(`${API}/reports/recruitment`).set(t.pm.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/reports/recruitment/export`).set(t.pm.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/reports/payroll-cost/export`).set(t.pm.h)).text).toContain('By month (approved and paid runs)');
  });
});
