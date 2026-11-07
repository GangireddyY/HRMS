import { DEFAULT_MERIT_MATRIX } from '../src/contracts';
import { EmployeeSalary, PerformanceReview } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const firstOfNextMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

describe('Salary-hike recommendations (e2e)', () => {
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

  it('recommends increases from the merit guidelines, approves them and applies them as salary revisions', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema');
    const pm = await person(org.organization.id, h, ['payroll_manager'], 'Priya');
    const mgr = await person(org.organization.id, h, ['department_manager'], 'Manoj', { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id, managerId: mgr.employee.id });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { departmentId: eng.id, managerId: mgr.employee.id });
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    await ctx.http().post(`${API}/payroll/employees/${asha.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' });
    await ctx.http().post(`${API}/payroll/employees/${ben.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 600000, effectiveFrom: '2024-01-08' });

    const cycle = (await ctx.http().post(`${API}/performance/cycles`).set(hr.h).send({ name: 'Annual review 2025-26', periodStart: '2025-04-01', periodEnd: '2026-03-31' })).body.data;
    const review = (employeeId: string, finalRating: number) => PerformanceReview.create({ organizationId: org.organization.id, cycleId: cycle.id, employeeId, reviewerId: mgr.employee.id, stage: 'COMPLETED', finalRating }, RAW);
    const ashaReview = await review(asha.employee.id, 4);
    const benReview = await review(ben.employee.id, 3);

    // HR sets the guidelines, budget and effective date.
    const effective = firstOfNextMonth();
    const bad = DEFAULT_MERIT_MATRIX.map((g) => (g.rating === 3 ? { ...g, min: 9 } : g));
    expect((await ctx.http().put(`${API}/performance/cycles/${cycle.id}/compensation`).set(hr.h).send({ meritMatrix: bad, budgetPercent: 8, effectiveFrom: effective })).status).toBe(422);
    expect((await ctx.http().put(`${API}/performance/cycles/${cycle.id}/compensation`).set(mgr.h).send({ meritMatrix: DEFAULT_MERIT_MATRIX })).status).toBe(403);
    const settings = await ctx.http().put(`${API}/performance/cycles/${cycle.id}/compensation`).set(hr.h).send({ meritMatrix: DEFAULT_MERIT_MATRIX, budgetPercent: 8, effectiveFrom: effective });
    expect(settings.body.data).toMatchObject({ configured: true, budgetPercent: 8, effectiveFrom: effective });

    // The reviewer recommends; amounts stay hidden from him (no salary access).
    let mine = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/hikes?view=mine`).set(mgr.h)).body.data.rows as { reviewId: string; guideline: { target: number }; currentCtc?: number; permissions: { edit: boolean } }[];
    expect(mine.map((r) => r.guideline.target).sort()).toEqual([10, 6].sort());
    expect(mine.every((r) => r.currentCtc === undefined && r.permissions.edit)).toBe(true);
    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview.id}/hike`).set(mgr.h).send({ percent: 15 })).status).toBe(422);
    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview.id}/hike`).set(asha.h).send({ percent: 10 })).status).toBe(403);
    const ashaRec = (await ctx.http().put(`${API}/performance/reviews/${ashaReview.id}/hike`).set(mgr.h).send({ percent: 15, promotion: true, justification: 'Led the platform rewrite' })).body.data;
    expect(ashaRec.recommendation).toMatchObject({ percent: 15, status: 'DRAFT', promotion: true, outsideGuideline: true, recommendedBy: 'Manoj Person' });
    expect(ashaRec.recommendation.newCtc).toBeUndefined();
    const benRec = (await ctx.http().put(`${API}/performance/reviews/${benReview.id}/hike`).set(mgr.h).send({ percent: 6 })).body.data;
    for (const r of [ashaRec, benRec]) expect((await ctx.http().post(`${API}/performance/hikes/${r.recommendation.id}/submit`).set(mgr.h).send({})).body.data.recommendation.status).toBe('SUBMITTED');
    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview.id}/hike`).set(mgr.h).send({ percent: 10 })).status).toBe(409);

    // HR sees the amounts and decides; the reviewer can't approve.
    const all = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/hikes`).set(hr.h)).body.data.rows as { employee: { name: string }; currentCtc: number; recommendation: { id: string; newCtc: number } }[];
    expect(all.find((r) => r.employee.name === 'Asha Person')).toMatchObject({ currentCtc: 720000, recommendation: { newCtc: 828000 } });
    expect((await ctx.http().post(`${API}/performance/hikes/${ashaRec.recommendation.id}/approve`).set(mgr.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/performance/hikes/${ashaRec.recommendation.id}/approve`).set(hr.h).send({ percent: 12, note: 'Capped at 12%' })).body.data.recommendation).toMatchObject({ status: 'APPROVED', percent: 12, newCtc: 806400, decidedBy: 'Hema Person' });
    expect((await ctx.http().post(`${API}/performance/hikes/${benRec.recommendation.id}/reject`).set(hr.h).send({})).status).toBe(422);
    await ctx.http().post(`${API}/performance/hikes/${benRec.recommendation.id}/reject`).set(hr.h).send({ note: 'Revisit with peer data' });
    // The reviewer revises the rejected one and someone else approves it.
    await ctx.http().put(`${API}/performance/reviews/${benReview.id}/hike`).set(mgr.h).send({ percent: 7 });
    await ctx.http().post(`${API}/performance/hikes/${benRec.recommendation.id}/submit`).set(mgr.h).send({});
    expect((await ctx.http().post(`${API}/performance/hikes/${benRec.recommendation.id}/approve`).set(pm.h).send({})).body.data.recommendation).toMatchObject({ status: 'APPROVED', percent: 7 });

    const comp = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/compensation`).set(hr.h)).body.data;
    expect(comp).toMatchObject({ counts: { APPROVED: 2 }, budget: { base: 1_320_000, pool: 105_600, approved: 128_400, remaining: -22_800 }, permissions: { apply: true } });

    // Applying creates the salary revisions.
    expect((await ctx.http().post(`${API}/performance/cycles/${cycle.id}/hikes/apply`).set(mgr.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/performance/cycles/${cycle.id}/hikes/apply`).set(pm.h).send({})).body.data).toEqual({ applied: 2, failed: [] });
    expect(await EmployeeSalary.findOne({ where: { employeeId: asha.employee.id, effectiveFrom: effective }, ...RAW })).toMatchObject({ annualCtc: '806400.00', reason: 'Promotion and increment – Annual review 2025-26' });
    mine = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/hikes?view=mine`).set(mgr.h)).body.data.rows;
    expect(mine.every((r) => !r.permissions.edit)).toBe(true);
    expect((await ctx.http().put(`${API}/performance/cycles/${cycle.id}/compensation`).set(hr.h).send({ meritMatrix: DEFAULT_MERIT_MATRIX, budgetPercent: 9 })).status).toBe(409);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/performance/cycles/${cycle.id}/hikes`).set(oh)).status).toBe(404);
  });
});
