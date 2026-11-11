import { DEFAULT_MERIT_MATRIX } from '../src/contracts';
import { PerformanceReview } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Compensation budgets and succession planning (e2e)', () => {
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

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    async function person(roles: string[], firstName: string, extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roles);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const hr = await person(['hr_manager'], 'Hema');
    const pm = await person(['payroll_manager'], 'Priya');
    const mgr = await person(['department_manager'], 'Manoj', { departmentId: eng.id });
    const asha = await person(['employee'], 'Asha', { departmentId: eng.id, managerId: mgr.employee.id });
    const ben = await person(['employee'], 'Ben', { departmentId: eng.id, managerId: mgr.employee.id });
    const cycle = (await ctx.http().post(`${API}/performance/cycles`).set(hr.h).send({ name: 'Annual review 2025-26', periodStart: '2025-04-01', periodEnd: '2026-03-31' })).body.data;
    return { ...org, h, eng, hr, pm, mgr, asha, ben, cycle };
  }

  it('splits the increase budget into department pools and blocks overspending without an override', async () => {
    const s = await setup();
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(s.h).send({})).body.data.structures.find((x: { name: string }) => x.name === 'Standard');
    await ctx.http().post(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' });
    await ctx.http().post(`${API}/payroll/employees/${s.ben.employee.id}/salaries`).set(s.pm.h).send({ structureId: structure.id, annualCtc: 600000, effectiveFrom: '2024-01-08' });
    await ctx.http().put(`${API}/performance/cycles/${s.cycle.id}/compensation`).set(s.hr.h).send({ meritMatrix: DEFAULT_MERIT_MATRIX, budgetPercent: 8 });

    // Suggested from the department's payroll and the cycle's 8%.
    expect((await ctx.http().get(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.mgr.h)).status).toBe(403);
    const before = (await ctx.http().get(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.hr.h)).body.data;
    const engPool = (p: { pools: { departmentId: string | null }[] }) => p.pools.find((x) => x.departmentId === s.eng.id)!;
    expect(engPool(before)).toMatchObject({ department: 'Engineering', headcount: 3, currentPayroll: 1_320_000, suggested: 105_600, amount: null, remaining: null });

    expect((await ctx.http().put(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.hr.h).send({ pools: [{ departmentId: s.eng.id, amount: 1 }, { departmentId: s.eng.id, amount: 2 }] })).status).toBe(422);
    const set = (await ctx.http().put(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.hr.h).send({ pools: [{ departmentId: s.eng.id, amount: 100_000, note: 'Tight year' }] })).body.data;
    expect(engPool(set)).toMatchObject({ amount: 100_000, planned: 0, committed: 0, remaining: 100_000 });

    const review = (employeeId: string, finalRating: number) => PerformanceReview.create({ organizationId: s.organization.id, cycleId: s.cycle.id, employeeId, reviewerId: s.mgr.employee.id, stage: 'COMPLETED', finalRating }, RAW);
    const ashaReview = await review(s.asha.employee.id, 4);
    const benReview = await review(s.ben.employee.id, 3);
    const ashaRec = (await ctx.http().put(`${API}/performance/reviews/${ashaReview.id}/hike`).set(s.mgr.h).send({ percent: 10 })).body.data.recommendation;
    const benRec = (await ctx.http().put(`${API}/performance/reviews/${benReview.id}/hike`).set(s.mgr.h).send({ percent: 6 })).body.data.recommendation;
    for (const r of [ashaRec, benRec]) await ctx.http().post(`${API}/performance/hikes/${r.id}/submit`).set(s.mgr.h).send({});
    const planned = (await ctx.http().get(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.hr.h)).body.data;
    expect(engPool(planned)).toMatchObject({ planned: 108_000, committed: 0, remaining: -8_000 });

    // 72,000 fits; the next 36,000 would overspend the 100,000 pool.
    expect((await ctx.http().post(`${API}/performance/hikes/${ashaRec.id}/approve`).set(s.hr.h).send({})).body.data.recommendation.status).toBe('APPROVED');
    const blocked = await ctx.http().post(`${API}/performance/hikes/${benRec.id}/approve`).set(s.hr.h).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/108000 against a pool of 100000/);
    // An explicit override goes over (and is audited).
    expect((await ctx.http().post(`${API}/performance/hikes/${benRec.id}/approve`).set(s.hr.h).send({ overBudget: true })).body.data.recommendation.status).toBe('APPROVED');
    const after = (await ctx.http().get(`${API}/performance/cycles/${s.cycle.id}/budgets`).set(s.hr.h)).body.data;
    expect(engPool(after)).toMatchObject({ planned: 0, committed: 108_000, remaining: -8_000 });
    expect(after.totals).toMatchObject({ amount: 100_000, committed: 108_000 });
  });

  it('keeps succession plans with a ranked bench, 9-box placement and scoped visibility', async () => {
    const s = await setup();
    await PerformanceReview.create({ organizationId: s.organization.id, cycleId: s.cycle.id, employeeId: s.asha.employee.id, reviewerId: s.mgr.employee.id, stage: 'COMPLETED', finalRating: 4, potential: 3 }, RAW);

    // HR manages plans; managers can't create them.
    expect((await ctx.http().post(`${API}/performance/succession`).set(s.mgr.h).send({ title: 'Engineering manager', criticality: 'HIGH', riskOfLoss: 'MEDIUM' })).status).toBe(403);
    const lead = (await ctx.http().post(`${API}/performance/succession`).set(s.hr.h).send({ title: 'Engineering manager', incumbentEmployeeId: s.mgr.employee.id, criticality: 'HIGH', riskOfLoss: 'HIGH', reviewBy: '2027-03-31' })).body.data;
    expect(lead).toMatchObject({ title: 'Engineering manager', incumbent: { name: 'Manoj Person' }, department: { name: 'Engineering' }, bench: 'NONE', canManage: true });
    expect((await ctx.http().post(`${API}/performance/succession`).set(s.hr.h).send({ title: 'Duplicate', incumbentEmployeeId: s.mgr.employee.id, criticality: 'LOW', riskOfLoss: 'LOW' })).status).toBe(409);

    // The holder can't be their own successor; each person once per bench.
    expect((await ctx.http().post(`${API}/performance/succession/${lead.id}/successors`).set(s.hr.h).send({ employeeId: s.mgr.employee.id, readiness: 'READY_NOW' })).status).toBe(422);
    await ctx.http().post(`${API}/performance/succession/${lead.id}/successors`).set(s.hr.h).send({ employeeId: s.ben.employee.id, readiness: 'ONE_TO_TWO_YEARS', rank: 2 });
    expect((await ctx.http().get(`${API}/performance/succession/${lead.id}`).set(s.hr.h)).body.data.bench).toBe('AT_RISK');
    const withAsha = (await ctx.http().post(`${API}/performance/succession/${lead.id}/successors`).set(s.hr.h).send({ employeeId: s.asha.employee.id, readiness: 'READY_NOW', rank: 1, developmentNotes: 'Stretch: run the Q3 planning' })).body.data;
    expect(withAsha.bench).toBe('COVERED');
    expect(withAsha.successors.map((x: { employee: { name: string } }) => x.employee.name)).toEqual(['Asha Person', 'Ben Person']);
    expect(withAsha.successors[0].nineBox).toEqual({ rating: 4, potential: 3, cycle: 'Annual review 2025-26' });
    expect((await ctx.http().post(`${API}/performance/succession/${lead.id}/successors`).set(s.hr.h).send({ employeeId: s.asha.employee.id, readiness: 'READY_NOW' })).status).toBe(409);

    // A vacant-role plan and a plan for someone in the manager's department.
    await ctx.http().post(`${API}/performance/succession`).set(s.hr.h).send({ title: 'Tech lead, payments', incumbentEmployeeId: s.asha.employee.id, criticality: 'MEDIUM', riskOfLoss: 'LOW' });
    await ctx.http().post(`${API}/performance/succession`).set(s.hr.h).send({ title: 'Head of data (vacant)', criticality: 'HIGH', riskOfLoss: 'HIGH' });
    const all = (await ctx.http().get(`${API}/performance/succession`).set(s.hr.h)).body.data;
    expect(all.summary).toMatchObject({ total: 3, COVERED: 1, NONE: 2, highRisk: 1 });
    expect(all.plans[0].criticality).toBe('HIGH');

    // The manager sees plans in his department but never the bench for his own role.
    const his = (await ctx.http().get(`${API}/performance/succession`).set(s.mgr.h)).body.data.plans.map((p: { title: string }) => p.title);
    expect(his).toEqual(['Tech lead, payments']);
    expect((await ctx.http().get(`${API}/performance/succession/${lead.id}`).set(s.mgr.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/performance/succession`).set(s.ben.h)).status).toBe(403);

    // Readiness changes and removal.
    const ben = withAsha.successors.find((x: { employee: { name: string } }) => x.employee.name === 'Ben Person');
    expect((await ctx.http().patch(`${API}/performance/succession/${lead.id}/successors/${ben.id}`).set(s.hr.h).send({ readiness: 'READY_NOW' })).body.data.successors.filter((x: { readiness: string }) => x.readiness === 'READY_NOW')).toHaveLength(2);
    expect((await ctx.http().delete(`${API}/performance/succession/${lead.id}/successors/${ben.id}`).set(s.hr.h)).body.data.successors).toHaveLength(1);
    expect((await ctx.http().delete(`${API}/performance/succession/${lead.id}`).set(s.hr.h)).status).toBe(204);
  });
});
