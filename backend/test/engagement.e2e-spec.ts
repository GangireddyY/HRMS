import { SurveyParticipant, SurveyResponse } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Engagement (e2e)', () => {
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

  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], { departmentId: ops.id });
    const asha = await person(org.organization.id, h, ['employee'], { departmentId: eng.id });
    const ben = await person(org.organization.id, h, ['employee'], { departmentId: eng.id });
    const chen = await person(org.organization.id, h, ['employee'], { departmentId: ops.id });
    return { org, h, eng, ops, hr, asha, ben, chen };
  }

  it('publishes targeted announcements and events with acknowledgements and RSVPs', async () => {
    const t = await team();
    const policy = await ctx.http().post(`${API}/engagement/announcements`).set(t.hr.h).send({ title: 'New code review policy', body: 'Every change needs two approvals from next week.', category: 'POLICY', requiresAck: true, departmentIds: [t.eng.id] });
    expect(policy.status).toBe(201);
    const id = policy.body.data.id;
    expect((await ctx.http().post(`${API}/engagement/announcements`).set(t.asha.h).send({ title: 'Hi all', body: 'Lunch?' })).status).toBe(403);
    // Drafts are invisible to employees.
    expect((await ctx.http().get(`${API}/engagement/announcements`).set(t.asha.h)).body.data).toEqual([]);
    expect((await ctx.http().get(`${API}/engagement/announcements/${id}`).set(t.asha.h)).status).toBe(404);
    await ctx.http().post(`${API}/engagement/announcements/${id}/publish`).set(t.hr.h).send({});

    // Engineering sees and acknowledges it; Operations doesn't see it.
    expect((await ctx.http().get(`${API}/engagement/announcements`).set(t.asha.h)).body.data).toEqual([expect.objectContaining({ id, mine: { acknowledgedAt: null, rsvp: null } })]);
    expect((await ctx.http().get(`${API}/engagement/announcements`).set(t.chen.h)).body.data).toEqual([]);
    expect((await ctx.http().post(`${API}/engagement/announcements/${id}/acknowledge`).set(t.chen.h).send({})).status).toBe(404);
    const acked = await ctx.http().post(`${API}/engagement/announcements/${id}/acknowledge`).set(t.asha.h).send({});
    expect(acked.body.data.mine.acknowledgedAt).toEqual(expect.any(String));
    expect(acked.body.data.counts).toBeUndefined();
    const tracking = (await ctx.http().get(`${API}/engagement/announcements/${id}/tracking`).set(t.hr.h)).body.data;
    expect(tracking.audience).toBe(2);
    expect(tracking.people.map((p: { employee: { id: string }; acknowledgedAt: string | null }) => [p.employee.id, !!p.acknowledgedAt])).toEqual([
      [t.ben.employee.id, false],
      [t.asha.employee.id, true],
    ]);

    // Events need a start time and take RSVPs.
    expect((await ctx.http().post(`${API}/engagement/announcements`).set(t.hr.h).send({ title: 'Town hall', body: 'Quarterly update', category: 'EVENT' })).status).toBe(422);
    const starts = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const event = (await ctx.http().post(`${API}/engagement/announcements`).set(t.hr.h).send({ title: 'Town hall', body: 'Quarterly update with Q&A', category: 'EVENT', eventStartsAt: starts, eventLocation: 'Cafeteria', pinned: true })).body.data;
    await ctx.http().post(`${API}/engagement/announcements/${event.id}/publish`).set(t.hr.h).send({});
    expect((await ctx.http().post(`${API}/engagement/announcements/${id}/rsvp`).set(t.asha.h).send({ response: 'GOING' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/engagement/announcements/${event.id}/rsvp`).set(t.chen.h).send({ response: 'GOING' })).body.data.mine.rsvp).toBe('GOING');
    const feed = (await ctx.http().get(`${API}/engagement/announcements`).set(t.asha.h)).body.data as { id: string }[];
    expect(feed.map((a) => a.id)).toEqual([event.id, id]);
    expect((await ctx.http().get(`${API}/engagement/announcements?manage=true`).set(t.hr.h)).body.data.find((a: { id: string }) => a.id === event.id).counts).toMatchObject({ going: 1 });

    await ctx.http().post(`${API}/engagement/announcements/${id}/archive`).set(t.hr.h).send({});
    expect((await ctx.http().get(`${API}/engagement/announcements`).set(t.asha.h)).body.data.map((a: { id: string }) => a.id)).toEqual([event.id]);
  });

  it('runs anonymous surveys: one answer each, unlinkable answers and a minimum group size', async () => {
    const t = await team();
    const survey = await ctx.http().post(`${API}/engagement/surveys`).set(t.hr.h).send({
      title: 'Pulse check',
      questions: [
        { type: 'RATING', prompt: 'How happy are you at work?' },
        { type: 'NPS', prompt: 'How likely are you to recommend us as an employer?' },
        { type: 'CHOICE', prompt: 'Favourite perk?', options: ['Hybrid work', 'Learning budget'], required: false },
        { type: 'TEXT', prompt: 'What should we improve?', required: false },
      ],
    });
    expect(survey.status).toBe(201);
    expect(survey.body.data).toMatchObject({ anonymous: true, status: 'DRAFT' });
    const id = survey.body.data.id;
    expect((await ctx.http().post(`${API}/engagement/surveys`).set(t.hr.h).send({ title: 'Bad', questions: [{ type: 'CHOICE', prompt: 'Pick', options: ['Only'] }] })).status).toBe(422);
    expect((await ctx.http().post(`${API}/engagement/surveys/${id}/responses`).set(t.asha.h).send({ answers: {} })).status).toBe(404);
    await ctx.http().post(`${API}/engagement/surveys/${id}/open`).set(t.hr.h).send({});
    expect((await ctx.http().patch(`${API}/engagement/surveys/${id}`).set(t.hr.h).send({ anonymous: false })).status).toBe(409);

    const q = (await ctx.http().get(`${API}/engagement/surveys/${id}`).set(t.asha.h)).body.data.questions as { id: string }[];
    expect((await ctx.http().get(`${API}/engagement/surveys`).set(t.asha.h)).body.data).toEqual([expect.objectContaining({ id, responded: false, questions: 4 })]);
    const missing = await ctx.http().post(`${API}/engagement/surveys/${id}/responses`).set(t.asha.h).send({ answers: { [q[0]!.id]: 4 } });
    expect(missing.status).toBe(422);
    const answer = (h: Record<string, string>, r: number, n: number, extra: Record<string, unknown> = {}) => ctx.http().post(`${API}/engagement/surveys/${id}/responses`).set(h).send({ answers: { [q[0]!.id]: r, [q[1]!.id]: n, ...extra } });
    expect((await answer(t.asha.h, 4, 10, { [q[2]!.id]: 1, [q[3]!.id]: 'More focus time' })).body.data.responded).toBe(true);
    expect((await answer(t.asha.h, 5, 10)).status).toBe(409);

    // Below the threshold, results stay hidden; answers carry no employee.
    await answer(t.ben.h, 3, 6);
    expect((await ctx.http().get(`${API}/engagement/surveys/${id}/results`).set(t.hr.h)).body.data).toMatchObject({ responses: 2, hidden: true, questions: [] });
    expect((await ctx.http().get(`${API}/engagement/surveys/${id}/results`).set(t.asha.h)).status).toBe(403);
    await answer(t.chen.h, 5, 9);
    const results = (await ctx.http().get(`${API}/engagement/surveys/${id}/results`).set(t.hr.h)).body.data;
    expect(results).toMatchObject({ responses: 3, hidden: false, respondents: null });
    expect(results.questions[0]).toMatchObject({ average: 4, answered: 3 });
    expect(results.questions[1]).toMatchObject({ nps: { score: 33, promoters: 2, detractors: 1 } });
    expect(results.questions[2]).toMatchObject({ distribution: { 0: 0, 1: 1 } });
    expect(results.questions[3]).toMatchObject({ texts: ['More focus time'] });
    const stored = await SurveyResponse.findAll({ where: { surveyId: id }, ...RAW });
    expect(stored.every((r) => r.employeeId === null)).toBe(true);
    expect((await SurveyParticipant.count({ where: { surveyId: id }, ...RAW }))).toBe(3);

    await ctx.http().post(`${API}/engagement/surveys/${id}/close`).set(t.hr.h).send({});
    expect((await ctx.http().get(`${API}/engagement/surveys`).set(t.ben.h)).body.data).toEqual([]);
  });

  it('shares recognition and handles suggestions, including anonymous ones', async () => {
    const t = await team();
    expect((await ctx.http().post(`${API}/engagement/recognitions`).set(t.asha.h).send({ recipientIds: [t.asha.employee.id], badge: 'TEAMWORK', message: 'Great work on the release!' })).status).toBe(422);
    const given = await ctx.http().post(`${API}/engagement/recognitions`).set(t.asha.h).send({ recipientIds: [t.ben.employee.id, t.chen.employee.id], badge: 'HELPING_HAND', message: 'Thanks for staying late to fix the build!' });
    expect(given.status).toBe(201);
    const feed = (await ctx.http().get(`${API}/engagement/recognitions`).set(t.chen.h)).body.data;
    expect(feed).toEqual([expect.objectContaining({ badge: 'HELPING_HAND', giver: expect.objectContaining({ id: t.asha.employee.id }), canDelete: false })]);
    expect(feed[0].recipients.map((r: { id: string }) => r.id).sort()).toEqual([t.ben.employee.id, t.chen.employee.id].sort());
    expect((await ctx.http().get(`${API}/engagement/recognitions?employeeId=${t.ben.employee.id}`).set(t.chen.h)).body.data).toHaveLength(1);
    expect((await ctx.http().get(`${API}/engagement/recognitions/stats`).set(t.ben.h)).body.data).toMatchObject({ thisMonth: 1, mine: { received: 1, given: 0 }, topRecipients: expect.arrayContaining([expect.objectContaining({ count: 1 })]) });
    expect((await ctx.http().delete(`${API}/engagement/recognitions/${feed[0].id}`).set(t.chen.h)).status).toBe(403);
    expect((await ctx.http().delete(`${API}/engagement/recognitions/${feed[0].id}`).set(t.asha.h)).status).toBe(200);

    const named = await ctx.http().post(`${API}/engagement/suggestions`).set(t.ben.h).send({ title: 'Standing desks', body: 'A few standing desks would help with back pain.', category: 'WORKPLACE' });
    const anon = await ctx.http().post(`${API}/engagement/suggestions`).set(t.ben.h).send({ title: 'Fewer meetings', body: 'Meeting-free Wednesdays would help focus.', category: 'CULTURE', anonymous: true });
    expect(anon.body.data).toMatchObject({ anonymous: true, author: null });
    // The author sees only the named one; reviewers see both, without the anonymous author.
    expect((await ctx.http().get(`${API}/engagement/suggestions`).set(t.ben.h)).body.data.map((s: { id: string }) => s.id)).toEqual([named.body.data.id]);
    expect((await ctx.http().get(`${API}/engagement/suggestions?view=all`).set(t.ben.h)).status).toBe(403);
    const all = (await ctx.http().get(`${API}/engagement/suggestions?view=all`).set(t.hr.h)).body.data as { id: string; author: { id: string } | null }[];
    expect(all.find((s) => s.id === anon.body.data.id)!.author).toBeNull();
    const reviewed = await ctx.http().patch(`${API}/engagement/suggestions/${named.body.data.id}`).set(t.hr.h).send({ status: 'ACCEPTED', response: 'Ordering five for the second floor.' });
    expect(reviewed.body.data).toMatchObject({ status: 'ACCEPTED', response: 'Ordering five for the second floor.' });
  });
});
