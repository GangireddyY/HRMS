import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const COMPETENCIES = [
  { key: 'communication', name: 'Communication' },
  { key: 'ownership', name: 'Ownership' },
];

describe('Performance (e2e)', () => {
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

  /** HR (configures), a department manager, their report (Asha) and a peer (Ben). */
  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager']);
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    const ben = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    return { org, h, eng, hr, manager, asha, ben };
  }

  async function launchedCycle(t: Awaited<ReturnType<typeof team>>, extra: Record<string, unknown> = {}) {
    const cycle = await ctx.http().post(`${API}/performance/cycles`).set(t.hr.h).send({ name: 'Annual review 2026', periodStart: '2026-04-01', periodEnd: '2027-03-31', goalsWeight: 70, competencies: COMPETENCIES, ...extra });
    expect(cycle.status).toBe(201);
    const launched = await ctx.http().post(`${API}/performance/cycles/${cycle.body.data.id}/launch`).set(t.hr.h).send({});
    expect(launched.status).toBe(201);
    return launched.body.data;
  }

  const reviewOf = async (h: Record<string, string>, view: string, employeeId: string) =>
    ((await ctx.http().get(`${API}/performance/reviews?view=${view}`).set(h)).body.data as { id: string; employee: { id: string }; reviewer: { id: string } | null; stage: string }[]).find(
      (r) => r.employee.id === employeeId,
    )!;

  it('runs a review from goals to calibrated, released results with anonymous peer feedback', async () => {
    const t = await team();
    const cycle = await launchedCycle(t);
    expect(cycle).toMatchObject({ status: 'ACTIVE', launchedFor: 4, participants: 4, withoutReviewer: 2 });

    const mine = await reviewOf(t.asha.h, 'mine', t.asha.employee.id);
    expect(mine).toMatchObject({ stage: 'GOAL_SETTING', reviewer: { id: t.manager.employee.id } });
    const id = mine.id;
    const url = `${API}/performance/reviews/${id}`;

    // Goals: weights must add up to 100%.
    await ctx.http().post(`${url}/goals`).set(t.asha.h).send({ title: 'Ship the payments API v2', measure: 'Live by Q3 with < 1% errors', weight: 60 });
    let r = (await ctx.http().post(`${url}/goals`).set(t.asha.h).send({ title: 'Mentor two new joiners', weight: 30 })).body.data;
    const bad = await ctx.http().post(`${url}/goals/submit`).set(t.asha.h).send({});
    expect(bad.status).toBe(422);
    expect(bad.body.error.details[0].message).toMatch(/add up to 90%/);
    const [g1, g2] = r.goals as { id: string }[];
    await ctx.http().patch(`${url}/goals/${g2!.id}`).set(t.asha.h).send({ weight: 40 });
    expect((await ctx.http().post(`${url}/goals/submit`).set(t.asha.h).send({})).body.data.stage).toBe('GOAL_APPROVAL');

    // The manager sends them back once, then approves; goals are then fixed.
    expect((await ctx.http().post(`${url}/goals/return`).set(t.manager.h).send({ note: 'Make the mentoring goal measurable' })).body.data).toMatchObject({ stage: 'GOAL_SETTING', goalsReturnNote: 'Make the mentoring goal measurable' });
    await ctx.http().patch(`${url}/goals/${g2!.id}`).set(t.asha.h).send({ measure: 'Both pass probation' });
    await ctx.http().post(`${url}/goals/submit`).set(t.asha.h).send({});
    expect((await ctx.http().post(`${url}/goals/approve`).set(t.ben.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${url}/goals/approve`).set(t.manager.h).send({})).body.data.stage).toBe('SELF_REVIEW');
    expect((await ctx.http().patch(`${url}/goals/${g1!.id}`).set(t.asha.h).send({ weight: 50 })).status).toBe(409);
    expect((await ctx.http().put(`${url}/goals/${g1!.id}/progress`).set(t.asha.h).send({ progress: 80, progressNote: 'In beta' })).body.data.goals[0].progress).toBe(80);

    // 360 feedback from a peer.
    expect((await ctx.http().post(`${url}/feedback-requests`).set(t.asha.h).send({ employeeIds: [t.asha.employee.id] })).status).toBe(422);
    await ctx.http().post(`${url}/feedback-requests`).set(t.asha.h).send({ employeeIds: [t.ben.employee.id] });
    const requests = (await ctx.http().get(`${API}/performance/feedback`).set(t.ben.h)).body.data;
    expect(requests).toEqual([expect.objectContaining({ status: 'REQUESTED', open: true, subject: expect.objectContaining({ id: t.asha.employee.id }) })]);
    await ctx.http().post(`${API}/performance/feedback/${requests[0].id}`).set(t.ben.h).send({ rating: 4, strengths: 'Clear design docs and reviews', improvements: 'Delegate more of the release work' });
    expect((await ctx.http().get(url).set(t.ben.h)).status).toBe(404);

    // Self-assessment must rate every goal and competency.
    const goals = [{ goalId: g1!.id, rating: 4, comment: 'Beta shipped' }, { goalId: g2!.id, rating: 4 }];
    const incomplete = await ctx.http().put(`${url}/self-assessment`).set(t.asha.h).send({ goals, submit: true });
    expect(incomplete.status).toBe(422);
    r = (await ctx.http().put(`${url}/self-assessment`).set(t.asha.h).send({ goals, competencies: [{ key: 'communication', rating: 4 }, { key: 'ownership', rating: 5 }], comment: 'A strong year', submit: true })).body.data;
    expect(r.stage).toBe('MANAGER_REVIEW');

    // Manager review: goals 4 (60%) and 3 (40%) → 3.6; competencies 4 and 3 → 3.5; 70/30 → 3.57 → rating 4.
    const managerView = (await ctx.http().get(url).set(t.manager.h)).body.data;
    expect(managerView.self).toMatchObject({ comment: 'A strong year' });
    expect(managerView.feedback).toEqual([expect.objectContaining({ giver: expect.objectContaining({ id: t.ben.employee.id }), status: 'SUBMITTED' })]);
    r = (
      await ctx.http().put(`${url}/manager-review`).set(t.manager.h).send({
        goals: [{ goalId: g1!.id, rating: 4 }, { goalId: g2!.id, rating: 3 }],
        competencies: [{ key: 'communication', rating: 4 }, { key: 'ownership', rating: 3 }],
        strengths: 'Owns delivery end to end',
        improvements: 'Plan mentoring time',
        submit: true,
      })
    ).body.data;
    expect(r).toMatchObject({ stage: 'COMPLETED', manager: { goalScore: 3.6, competencyScore: 3.5, overallScore: 3.57, finalRating: 4, rating: 4 } });

    // Not visible to the employee before release; HR calibrates.
    const hidden = (await ctx.http().get(url).set(t.asha.h)).body.data;
    expect(hidden).toMatchObject({ manager: null, feedback: [] });
    expect(hidden.goals[0].managerRating).toBeNull();
    expect((await ctx.http().post(`${url}/acknowledge`).set(t.asha.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${url}/calibrate`).set(t.manager.h).send({ rating: 3, note: 'Calibrated' })).status).toBe(403);
    expect((await ctx.http().post(`${url}/calibrate`).set(t.hr.h).send({ rating: 3, note: 'Aligned with the engineering calibration panel' })).body.data.manager).toMatchObject({ finalRating: 4, calibratedRating: 3, rating: 3 });
    expect((await ctx.http().get(`${API}/performance/cycles/${cycle.id}`).set(t.hr.h)).body.data).toMatchObject({ distribution: { 3: 1 }, calibrated: 1 });

    // Released: the employee sees the calibrated rating and anonymous feedback, then acknowledges.
    await ctx.http().post(`${API}/performance/cycles/${cycle.id}/release`).set(t.hr.h).send({});
    const shown = (await ctx.http().get(url).set(t.asha.h)).body.data;
    expect(shown.manager).toMatchObject({ rating: 3, strengths: 'Owns delivery end to end', calibrationNote: null });
    expect(shown.feedback).toEqual([expect.objectContaining({ giver: null, strengths: 'Clear design docs and reviews' })]);
    expect((await ctx.http().post(`${url}/calibrate`).set(t.hr.h).send({ rating: 4, note: 'Changed my mind' })).status).toBe(409);
    expect((await ctx.http().post(`${url}/acknowledge`).set(t.asha.h).send({ comment: 'Thanks, agreed' })).body.data).toMatchObject({ stage: 'ACKNOWLEDGED', employeeResponse: 'Thanks, agreed' });

    // Other tenants see nothing.
    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(url).set(oh)).status).toBe(404);
  });

  it('enforces cycle rules and reviewer assignment', async () => {
    const t = await team();
    const noCompetencies = await ctx.http().post(`${API}/performance/cycles`).set(t.hr.h).send({ name: 'H1 2026', periodStart: '2026-04-01', periodEnd: '2026-09-30' });
    expect((await ctx.http().post(`${API}/performance/cycles/${noCompetencies.body.data.id}/launch`).set(t.hr.h).send({})).status).toBe(422);
    expect((await ctx.http().delete(`${API}/performance/cycles/${noCompetencies.body.data.id}`).set(t.hr.h)).status).toBe(200);
    expect((await ctx.http().post(`${API}/performance/cycles`).set(t.manager.h).send({ name: 'Mine', periodStart: '2026-04-01', periodEnd: '2026-09-30' })).status).toBe(403);

    const cycle = await launchedCycle(t, { goalsWeight: 100, competencies: [], departmentIds: [t.eng.id] });
    expect(cycle.participants).toBe(3);
    expect((await ctx.http().patch(`${API}/performance/cycles/${cycle.id}`).set(t.hr.h).send({ goalsWeight: 50 })).status).toBe(409);
    expect((await ctx.http().patch(`${API}/performance/cycles/${cycle.id}`).set(t.hr.h).send({ selfReviewDue: '2027-02-15' })).status).toBe(200);

    // The manager has no manager: HR assigns a reviewer (never the employee themself).
    const managerReview = await reviewOf(t.hr.h, 'all', t.manager.employee.id);
    expect(managerReview.reviewer).toBeNull();
    expect((await ctx.http().post(`${API}/performance/reviews/${managerReview.id}/goals/submit`).set(t.manager.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/performance/reviews/${managerReview.id}/reviewer`).set(t.hr.h).send({ reviewerId: t.manager.employee.id })).status).toBe(422);
    const assigned = await ctx.http().post(`${API}/performance/reviews/${managerReview.id}/reviewer`).set(t.hr.h).send({ reviewerId: t.hr.employee.id });
    expect(assigned.body.data.reviewer.id).toBe(t.hr.employee.id);
    // The department manager sees the department's reviews; a peer only their own.
    expect(((await ctx.http().get(`${API}/performance/reviews?view=all`).set(t.manager.h)).body.data as unknown[]).length).toBe(3);
    expect(((await ctx.http().get(`${API}/performance/reviews?view=all`).set(t.ben.h)).body.data as { employee: { id: string } }[]).map((r) => r.employee.id)).toEqual([t.ben.employee.id]);

    await ctx.http().post(`${API}/performance/cycles/${cycle.id}/close`).set(t.hr.h).send({});
    const ben = await reviewOf(t.ben.h, 'mine', t.ben.employee.id);
    expect((await ctx.http().post(`${API}/performance/reviews/${ben.id}/goals`).set(t.ben.h).send({ title: 'Too late', weight: 100 })).status).toBe(409);
  });

  it('manages improvement plans with check-ins, acknowledgement and an outcome', async () => {
    const t = await team();
    const body = { employeeId: t.asha.employee.id, reason: 'Delivery commitments missed three sprints running.', objectives: [{ title: 'Meet sprint commitments', measure: '3 of the next 4 sprints' }, { title: 'Daily stand-up updates' }], startDate: '2026-11-01', endDate: '2027-01-31' };
    expect((await ctx.http().post(`${API}/performance/pips`).set(t.ben.h).send(body)).status).toBe(403);
    expect((await ctx.http().post(`${API}/performance/pips`).set(t.manager.h).send({ ...body, employeeId: t.manager.employee.id })).status).toBe(403);
    const pip = await ctx.http().post(`${API}/performance/pips`).set(t.manager.h).send(body);
    expect(pip.status).toBe(201);
    expect(pip.body.data).toMatchObject({ status: 'ACTIVE', owner: { id: t.manager.employee.id }, objectives: [{ title: 'Meet sprint commitments', met: null }, { title: 'Daily stand-up updates', met: null }] });
    expect((await ctx.http().post(`${API}/performance/pips`).set(t.manager.h).send(body)).status).toBe(409);
    const id = pip.body.data.id;

    await ctx.http().post(`${API}/performance/pips/${id}/check-ins`).set(t.manager.h).send({ checkInDate: '2026-11-05', progress: 'SOME_PROGRESS', note: 'Two of three tickets done' });
    expect((await ctx.http().post(`${API}/performance/pips/${id}/check-ins`).set(t.asha.h).send({ checkInDate: '2026-11-05', progress: 'ON_TRACK', note: 'Doing great' })).status).toBe(403);
    const mine = (await ctx.http().get(`${API}/performance/pips?view=mine`).set(t.asha.h)).body.data;
    expect(mine).toEqual([expect.objectContaining({ id, acknowledged: false })]);
    expect((await ctx.http().post(`${API}/performance/pips/${id}/acknowledge`).set(t.asha.h).send({ comment: 'Understood' })).body.data).toMatchObject({ employeeComment: 'Understood', checkIns: [expect.objectContaining({ progress: 'SOME_PROGRESS' })] });
    expect((await ctx.http().get(`${API}/performance/pips/${id}`).set(t.ben.h)).status).toBe(404);

    const closed = await ctx.http().post(`${API}/performance/pips/${id}/close`).set(t.manager.h).send({ outcome: 'SUCCESSFUL', note: 'Commitments met for four sprints.', objectivesMet: [true, true] });
    expect(closed.body.data).toMatchObject({ status: 'SUCCESSFUL', objectives: [{ met: true }, { met: true }] });
    expect((await ctx.http().post(`${API}/performance/pips/${id}/check-ins`).set(t.manager.h).send({ checkInDate: '2026-11-05', progress: 'ON_TRACK', note: 'After close' })).status).toBe(409);
  });
});
