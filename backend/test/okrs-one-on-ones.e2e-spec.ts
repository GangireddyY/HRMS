import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PERIOD = { periodStart: '2026-10-01', periodEnd: '2026-12-31' };
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('OKRs, 1:1s and calibration (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  /** HR, an engineering department manager with two reports (Asha, Ben), and a Sales department. */
  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const sales = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Sales' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager']);
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    const ben = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    return { org, h, eng, sales, hr, manager, asha, ben };
  }

  const notificationTitles = async (h: Record<string, string>) => ((await ctx.http().get(`${API}/notifications`).set(h)).body.data as { title: string }[]).map((n) => n.title);

  it('aligns company, department and individual objectives with weighted, checked-in key results', async () => {
    const t = await team();
    const okrs = `${API}/performance/okrs`;

    const company = await ctx.http().post(okrs).set(t.hr.h).send({
      title: 'Grow revenue to 10 Cr ARR',
      level: 'COMPANY',
      ...PERIOD,
      keyResults: [
        { title: 'Sign 100 new customers', metric: 'NUMBER', startValue: 0, targetValue: 100, unit: 'customers', weight: 2 },
        { title: 'Launch the v2 platform', metric: 'MILESTONE' },
      ],
    });
    expect(company.status).toBe(201);
    expect(company.body.data).toMatchObject({ level: 'COMPANY', progress: 0, health: null, keyResults: [{ targetValue: 100, weight: 2 }, { metric: 'MILESTONE', startValue: 0, targetValue: 1, unit: null }] });
    const [customers, launch] = company.body.data.keyResults as { id: string }[];

    // Only organization-wide OKR managers set company objectives; department managers set their own department's.
    expect((await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Company goal', level: 'COMPANY', ...PERIOD })).status).toBe(403);
    expect((await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Sales goal', level: 'DEPARTMENT', departmentId: t.sales.id, ...PERIOD })).status).toBe(403);
    const dept = await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Ship v2 on time', level: 'DEPARTMENT', departmentId: t.eng.id, parentId: company.body.data.id, ...PERIOD });
    expect(dept.status).toBe(201);
    expect((await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Bad parent', level: 'COMPANY', parentId: dept.body.data.id, ...PERIOD })).status).toBe(403);

    // Individuals: your own, or someone you review.
    const mine = await ctx.http().post(okrs).set(t.asha.h).send({ title: 'Own the payments API', level: 'INDIVIDUAL', parentId: dept.body.data.id, ...PERIOD, keyResults: [{ title: 'Test coverage', metric: 'PERCENT', startValue: 40, targetValue: 90 }] });
    expect(mine.status).toBe(201);
    expect(mine.body.data).toMatchObject({ owner: { id: t.asha.employee.id }, parentId: dept.body.data.id, keyResults: [{ unit: '%', currentValue: 40, progress: 0 }] });
    expect((await ctx.http().post(okrs).set(t.asha.h).send({ title: 'For Ben', level: 'INDIVIDUAL', ownerEmployeeId: t.ben.employee.id, ...PERIOD })).status).toBe(403);
    expect((await ctx.http().post(okrs).set(t.asha.h).send({ title: 'Company', level: 'COMPANY', ...PERIOD })).status).toBe(403);
    const forBen = await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Improve on-call', level: 'INDIVIDUAL', ownerEmployeeId: t.ben.employee.id, ...PERIOD });
    expect(forBen.status).toBe(201);
    expect(await notificationTitles(t.ben.h)).toContain('A new objective was set for you: Improve on-call');

    // A department objective can't support an individual one; periods must overlap.
    const badLevel = await ctx.http().post(okrs).set(t.manager.h).send({ title: 'Upside down', level: 'DEPARTMENT', departmentId: t.eng.id, parentId: mine.body.data.id, ...PERIOD });
    expect(badLevel.status).toBe(422);
    expect((await ctx.http().post(okrs).set(t.asha.h).send({ title: 'Next year', level: 'INDIVIDUAL', parentId: dept.body.data.id, periodStart: '2027-04-01', periodEnd: '2027-06-30' })).status).toBe(422);

    // Check-ins: weighted progress (customers ×2, launch ×1) and the latest health.
    let o = (await ctx.http().post(`${okrs}/key-results/${customers!.id}/check-ins`).set(t.hr.h).send({ value: 50, health: 'AT_RISK', note: 'Pipeline is slow' })).body.data;
    expect(o).toMatchObject({ progress: 33, health: 'AT_RISK' });
    expect((await ctx.http().post(`${okrs}/key-results/${launch!.id}/check-ins`).set(t.hr.h).send({ value: 0.5, health: 'ON_TRACK' })).status).toBe(422);
    o = (await ctx.http().post(`${okrs}/key-results/${launch!.id}/check-ins`).set(t.hr.h).send({ value: 1, health: 'ON_TRACK' })).body.data;
    expect(o).toMatchObject({ progress: 67, health: 'ON_TRACK' });
    expect(o.keyResults[0].checkIns).toEqual([expect.objectContaining({ value: 50, health: 'AT_RISK', note: 'Pipeline is slow' })]);

    // The owner and their reviewer check in on an individual key result; a peer can't.
    const coverage = mine.body.data.keyResults[0].id;
    expect((await ctx.http().post(`${okrs}/key-results/${coverage}/check-ins`).set(t.ben.h).send({ value: 60, health: 'ON_TRACK' })).status).toBe(403);
    expect((await ctx.http().post(`${okrs}/key-results/${coverage}/check-ins`).set(t.asha.h).send({ value: 65, health: 'ON_TRACK' })).body.data.progress).toBe(50);
    expect((await ctx.http().post(`${okrs}/key-results/${coverage}/check-ins`).set(t.manager.h).send({ value: 90, health: 'ON_TRACK', note: 'Done' })).body.data.progress).toBe(100);
    expect(await notificationTitles(t.asha.h)).toContain('Check-in on "Test coverage" (Own the payments API)');

    // Loops are refused.
    const company2 = (await ctx.http().post(okrs).set(t.hr.h).send({ title: 'Expand to the Middle East', level: 'COMPANY', parentId: company.body.data.id, ...PERIOD })).body.data;
    expect((await ctx.http().patch(`${okrs}/${company.body.data.id}`).set(t.hr.h).send({ parentId: company2.id })).status).toBe(422);

    // Everyone sees the OKRs; edit rights differ. Dropped objectives are left out.
    await ctx.http().patch(`${okrs}/${company2.id}`).set(t.hr.h).send({ status: 'DROPPED' });
    const list = (await ctx.http().get(`${okrs}?date=2026-11-15`).set(t.ben.h)).body.data;
    expect(list.objectives).toHaveLength(4);
    const byTitle = new Map((list.objectives as { title: string; canEdit: boolean }[]).map((x) => [x.title, x]));
    expect(byTitle.get('Grow revenue to 10 Cr ARR')!.canEdit).toBe(false);
    expect(byTitle.get('Improve on-call')!.canEdit).toBe(true);
    expect(list.summary).toMatchObject({ total: 4, onTrack: 2, noCheckIn: 2 });
    expect(list.can).toMatchObject({ company: false, department: false, individual: true, forOthers: false });
    expect((await ctx.http().get(`${okrs}?date=2027-02-01`).set(t.ben.h)).body.data.objectives).toHaveLength(0);

    // Deleting a parent leaves the children unaligned.
    const detail = (await ctx.http().get(`${okrs}/${dept.body.data.id}`).set(t.asha.h)).body.data;
    expect(detail).toMatchObject({ parent: { id: company.body.data.id }, children: [expect.objectContaining({ id: mine.body.data.id })], canEdit: false });
    expect((await ctx.http().delete(`${okrs}/${dept.body.data.id}`).set(t.asha.h)).status).toBe(403);
    expect((await ctx.http().delete(`${okrs}/${dept.body.data.id}`).set(t.manager.h)).status).toBe(200);
    expect((await ctx.http().get(`${okrs}/${mine.body.data.id}`).set(t.asha.h)).body.data.parentId).toBeNull();

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${okrs}/${company.body.data.id}`).set(oh)).status).toBe(404);
  });

  it('runs 1:1s with a shared agenda, private manager notes and actions that carry over', async () => {
    const t = await team();
    const base = `${API}/performance/one-on-ones`;

    const created = await ctx.http().post(base).set(t.manager.h).send({ employeeId: t.asha.employee.id, scheduledAt: inDays(2), durationMinutes: 45, topics: ['Career goals'] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'SCHEDULED', durationMinutes: 45, items: [expect.objectContaining({ kind: 'TOPIC', text: 'Career goals' })], viewer: { isManager: true } });
    expect((await notificationTitles(t.asha.h)).some((x) => x.includes('scheduled a 1:1 with you'))).toBe(true);

    // Only the two people in it see it; scheduling needs performance.review over the employee.
    expect((await ctx.http().get(`${base}/${id}`).set(t.ben.h)).status).toBe(404);
    expect((await ctx.http().get(`${base}/${id}`).set(t.hr.h)).status).toBe(404);
    expect((await ctx.http().post(base).set(t.ben.h).send({ employeeId: t.asha.employee.id, scheduledAt: inDays(3) })).status).toBe(403);
    expect((await ctx.http().post(base).set(t.manager.h).send({ employeeId: t.hr.employee.id, scheduledAt: inDays(3) })).status).toBe(404);
    expect((await ctx.http().post(base).set(t.manager.h).send({ employeeId: t.manager.employee.id, scheduledAt: inDays(3) })).status).toBe(422);

    // The employee adds topics and shared notes; private notes stay the manager's.
    await ctx.http().post(`${base}/${id}/items`).set(t.asha.h).send({ kind: 'TOPIC', text: 'Conference budget' });
    expect(await notificationTitles(t.manager.h)).toContain(`${t.asha.employee.firstName} ${t.asha.employee.lastName} added a topic for your 1:1`);
    expect((await ctx.http().patch(`${base}/${id}`).set(t.asha.h).send({ sharedNotes: 'Wants to lead the v2 launch' })).status).toBe(200);
    expect((await ctx.http().patch(`${base}/${id}`).set(t.asha.h).send({ managerNotes: 'peek' })).status).toBe(403);
    expect((await ctx.http().patch(`${base}/${id}`).set(t.asha.h).send({ scheduledAt: inDays(4) })).status).toBe(403);
    await ctx.http().patch(`${base}/${id}`).set(t.manager.h).send({ managerNotes: 'Ready for a stretch role' });
    expect((await ctx.http().get(`${base}/${id}`).set(t.asha.h)).body.data).toMatchObject({ sharedNotes: 'Wants to lead the v2 launch', managerNotes: null, permissions: { complete: false } });
    expect((await ctx.http().get(`${base}/${id}`).set(t.manager.h)).body.data.managerNotes).toBe('Ready for a stretch role');

    // Actions belong to one of the two.
    expect((await ctx.http().post(`${base}/${id}/items`).set(t.manager.h).send({ kind: 'ACTION', text: 'Share the launch plan', ownerEmployeeId: t.ben.employee.id })).status).toBe(422);
    const withAction = (await ctx.http().post(`${base}/${id}/items`).set(t.manager.h).send({ kind: 'ACTION', text: 'Share the launch plan', ownerEmployeeId: t.asha.employee.id, dueDate: '2026-12-01' })).body.data;
    const career = (withAction.items as { id: string; text: string }[]).find((i) => i.text === 'Career goals')!;
    expect((await ctx.http().patch(`${base}/items/${career.id}`).set(t.asha.h).send({ text: 'Reworded' })).status).toBe(403);
    await ctx.http().patch(`${base}/items/${career.id}`).set(t.asha.h).send({ done: true });

    // Completing schedules the next one with what's still open.
    expect((await ctx.http().post(`${base}/${id}/complete`).set(t.asha.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${base}/${id}/complete`).set(t.manager.h).send({ nextAt: inDays(-1) })).status).toBe(422);
    const done = (await ctx.http().post(`${base}/${id}/complete`).set(t.manager.h).send({ nextAt: inDays(16) })).body.data;
    expect(done).toMatchObject({ status: 'DONE', next: { id: expect.any(String) } });
    const next = (await ctx.http().get(`${base}/${done.next.id}`).set(t.asha.h)).body.data;
    expect((next.items as { text: string; kind: string }[]).map((i) => i.text).sort()).toEqual(['Conference budget', 'Share the launch plan']);
    expect(next).toMatchObject({ durationMinutes: 45, previous: { id } });
    expect((await ctx.http().delete(`${base}/items/${career.id}`).set(t.manager.h)).status).toBe(409);

    // The manager's team view: last and next per report.
    const roster = (await ctx.http().get(`${base}/team`).set(t.manager.h)).body.data as { employee: { id: string }; last: unknown; next: unknown }[];
    expect(roster.find((r) => r.employee.id === t.asha.employee.id)).toMatchObject({ last: { id }, next: { id: done.next.id, overdue: false }, daysSinceLast: 0 });
    expect(roster.find((r) => r.employee.id === t.ben.employee.id)).toMatchObject({ last: null, next: null });
    expect((await ctx.http().get(`${base}/team`).set(t.asha.h)).status).toBe(403);

    // Cancelling.
    expect((await ctx.http().post(`${base}/${done.next.id}/cancel`).set(t.manager.h).send({})).body.data.status).toBe('CANCELLED');
    expect((await ctx.http().post(`${base}/${done.next.id}/items`).set(t.asha.h).send({ kind: 'TOPIC', text: 'Late topic' })).status).toBe(409);
    expect((await notificationTitles(t.asha.h)).some((x) => x.includes('was cancelled'))).toBe(true);

    const mineList = (await ctx.http().get(`${base}?view=mine`).set(t.asha.h)).body.data as { id: string; status: string; topics: number; openActions: number }[];
    expect(mineList.map((m) => m.status)).toEqual(['CANCELLED', 'DONE']);
    expect(mineList[1]).toMatchObject({ topics: 2, openActions: 1 });
    expect((await ctx.http().get(`${base}?view=team`).set(t.manager.h)).body.meta.total).toBe(2);
  });

  it('compares the rating spread with the target curve and places people on the 9-box', async () => {
    const t = await team();
    const bad = await ctx.http().post(`${API}/performance/cycles`).set(t.hr.h).send({ name: 'Annual 2026', periodStart: '2026-04-01', periodEnd: '2027-03-31', goalsWeight: 100, targetDistribution: [10, 20, 40, 20, 0] });
    expect(bad.status).toBe(422);
    const cycle = (await ctx.http().post(`${API}/performance/cycles`).set(t.hr.h).send({ name: 'Annual 2026', periodStart: '2026-04-01', periodEnd: '2027-03-31', goalsWeight: 100, targetDistribution: [10, 20, 40, 20, 10] })).body.data;
    expect(cycle.targetDistribution).toEqual([10, 20, 40, 20, 10]);
    await ctx.http().post(`${API}/performance/cycles/${cycle.id}/launch`).set(t.hr.h).send({});
    const reviews = (await ctx.http().get(`${API}/performance/reviews?view=all&pageSize=50`).set(t.hr.h)).body.data as { id: string; employee: { id: string } }[];
    const reviewOf = (employeeId: string) => reviews.find((r) => r.employee.id === employeeId)!.id;
    const ashaReview = reviewOf(t.asha.employee.id);

    // Potential is set once the manager review is in, by the reviewer or HR, never by the employee.
    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview}/potential`).set(t.manager.h).send({ potential: 3 })).status).toBe(409);
    const complete = async (employeeId: string, rating: number) =>
      ctx.db.sequelize.query(`UPDATE performance_reviews SET stage = 'COMPLETED', final_rating = :rating, manager_submitted_at = now() WHERE cycle_id = :cycle AND employee_id = :employeeId`, { replacements: { rating, cycle: cycle.id, employeeId } });
    await complete(t.asha.employee.id, 5);
    await complete(t.ben.employee.id, 3);
    await complete(t.manager.employee.id, 3);

    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview}/potential`).set(t.asha.h).send({ potential: 3 })).status).toBe(403);
    expect((await ctx.http().put(`${API}/performance/reviews/${ashaReview}/potential`).set(t.manager.h).send({ potential: 4 })).status).toBe(422);
    const set = await ctx.http().put(`${API}/performance/reviews/${ashaReview}/potential`).set(t.manager.h).send({ potential: 3 });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ manager: { potential: 3 }, permissions: { setPotential: true } });
    await ctx.http().put(`${API}/performance/reviews/${reviewOf(t.ben.employee.id)}/potential`).set(t.hr.h).send({ potential: 1 });

    // HR's calibration view.
    expect((await ctx.http().get(`${API}/performance/cycles/${cycle.id}/calibration`).set(t.manager.h)).status).toBe(403);
    let view = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/calibration`).set(t.hr.h)).body.data;
    expect(view).toMatchObject({ rated: 3, pending: 1, withoutPotential: 1, targetIsCustom: true, canCalibrate: true });
    expect(view.distribution[2]).toMatchObject({ rating: 3, count: 2, percent: 66.7, target: 40, expected: 1, gap: 1 });
    expect(view.distribution[4]).toMatchObject({ rating: 5, count: 1, target: 10, expected: 0, gap: 1 });
    const star = (view.nineBox as { performance: number; potential: number; label: string; count: number }[]).find((c) => c.performance === 2 && c.potential === 2)!;
    expect(star).toMatchObject({ label: 'Star', count: 1 });
    expect((view.people as { employee: { id: string }; box: { label: string } | null }[]).find((p) => p.employee.id === t.ben.employee.id)!.box).toMatchObject({ label: 'Effective' });

    // Calibrating moves people; the target can still be tuned while the cycle runs.
    await ctx.http().post(`${API}/performance/reviews/${ashaReview}/calibrate`).set(t.hr.h).send({ rating: 3, note: 'Aligned with the panel' });
    expect((await ctx.http().patch(`${API}/performance/cycles/${cycle.id}`).set(t.hr.h).send({ targetDistribution: [5, 15, 50, 20, 10] })).status).toBe(200);
    view = (await ctx.http().get(`${API}/performance/cycles/${cycle.id}/calibration?departmentId=${t.eng.id}`).set(t.hr.h)).body.data;
    expect(view.distribution[2]).toMatchObject({ rating: 3, count: 3, target: 50 });
    expect(view.people.find((p: { employee: { id: string } }) => p.employee.id === t.asha.employee.id)).toMatchObject({ finalRating: 5, calibratedRating: 3, rating: 3, box: { label: 'High potential' } });

    // The employee never sees their potential.
    await ctx.http().post(`${API}/performance/cycles/${cycle.id}/release`).set(t.hr.h).send({});
    expect((await ctx.http().get(`${API}/performance/reviews/${ashaReview}`).set(t.asha.h)).body.data.manager).toMatchObject({ rating: 3, potential: null });
    expect((await ctx.http().get(`${API}/performance/cycles/${cycle.id}/calibration`).set(t.hr.h)).body.data.canCalibrate).toBe(false);
  });
});
