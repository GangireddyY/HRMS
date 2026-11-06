import { TrainingEnrollment } from '../src/database/models';
import { addDays } from '../src/common/utils/zoned-time';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const QUESTIONS = [
  { prompt: 'Who can raise a POSH complaint?', options: ['Only women employees', 'Any aggrieved woman at the workplace', 'Only managers'], correctIndex: 1 },
  { prompt: 'Within how many months of an incident should a complaint usually be made?', options: ['3 months', '12 months'], correctIndex: 0 },
  { prompt: 'Who heads the Internal Committee?', options: ['The CEO', 'A senior woman employee', 'An external lawyer'], correctIndex: 1 },
];
const today = () => new Date().toISOString().slice(0, 10);

describe('Training (e2e)', () => {
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
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const asha = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    const ben = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    return { org, h, eng, ops, hr, manager, asha, ben };
  }

  it('runs a self-paced course with an assessment, certificate, feedback and renewal', async () => {
    const t = await team();
    const course = await ctx.http().post(`${API}/training/courses`).set(t.hr.h).send({
      code: 'posh-101', title: 'Prevention of sexual harassment', category: 'COMPLIANCE', delivery: 'SELF_PACED', contentUrl: 'https://learn.example.com/posh', durationHours: 1.5, mandatory: true, hasAssessment: true, passMark: 70, maxAttempts: 2, validityMonths: 12,
    });
    expect(course.status).toBe(201);
    expect(course.body.data).toMatchObject({ code: 'POSH-101', status: 'DRAFT', questionCount: 0 });
    const id = course.body.data.id;
    expect((await ctx.http().get(`${API}/training/courses/${id}`).set(t.asha.h)).status).toBe(404);
    expect((await ctx.http().post(`${API}/training/courses/${id}/publish`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().put(`${API}/training/courses/${id}/questions`).set(t.hr.h).send({ questions: [{ prompt: 'Broken?', options: ['a', 'b'], correctIndex: 3 }] })).status).toBe(422);
    await ctx.http().put(`${API}/training/courses/${id}/questions`).set(t.hr.h).send({ questions: QUESTIONS });
    expect((await ctx.http().post(`${API}/training/courses/${id}/publish`).set(t.hr.h).send({})).body.data.status).toBe('PUBLISHED');
    expect((await ctx.http().patch(`${API}/training/courses/${id}`).set(t.hr.h).send({ hasAssessment: false })).status).toBe(409);
    expect((await ctx.http().post(`${API}/training/courses`).set(t.asha.h).send({ code: 'X1', title: 'Nope', category: 'OTHER', delivery: 'SELF_PACED' })).status).toBe(403);

    // The learner enrols from the catalog; the assessment never reveals answers.
    const catalog = (await ctx.http().get(`${API}/training/courses`).set(t.asha.h)).body.data;
    expect(catalog).toEqual([expect.objectContaining({ id, myEnrollment: null })]);
    const enrolled = await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.asha.h).send({});
    expect(enrolled.body.data).toMatchObject({ status: 'ENROLLED', source: 'SELF', requirementsLeft: ['Pass the assessment'] });
    const eid = enrolled.body.data.id;
    expect((await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.asha.h).send({})).status).toBe(409);
    const quiz = (await ctx.http().get(`${API}/training/enrollments/${eid}/assessment`).set(t.asha.h)).body.data;
    expect(quiz).toMatchObject({ passMark: 70, attemptsLeft: 2 });
    expect(JSON.stringify(quiz)).not.toContain('correctIndex');
    const [q1, q2, q3] = quiz.questions as { id: string }[];

    // First attempt: 1 of 3 → 33%; marking done isn't allowed for assessed courses.
    const fail = await ctx.http().post(`${API}/training/enrollments/${eid}/attempts`).set(t.asha.h).send({ answers: { [q1!.id]: 1, [q2!.id]: 1, [q3!.id]: 0 } });
    expect(fail.body.data.result).toEqual({ correct: 1, total: 3, score: 33, passed: false });
    expect(fail.body.data.enrollment).toMatchObject({ status: 'IN_PROGRESS', attempts: 1, bestScore: 33 });
    expect((await ctx.http().post(`${API}/training/enrollments/${eid}/done`).set(t.asha.h).send({})).status).toBe(409);
    // Someone else can't take it for her.
    expect((await ctx.http().post(`${API}/training/enrollments/${eid}/attempts`).set(t.hr.h).send({ answers: {} })).status).toBe(403);

    const pass = await ctx.http().post(`${API}/training/enrollments/${eid}/attempts`).set(t.asha.h).send({ answers: { [q1!.id]: 1, [q2!.id]: 0, [q3!.id]: 1 } });
    expect(pass.body.data.result).toMatchObject({ score: 100, passed: true });
    const done = pass.body.data.enrollment;
    expect(done).toMatchObject({ status: 'COMPLETED', passed: true, bestScore: 100, completedOn: expect.any(String), certification: 'VALID' });
    expect(done.certificateNumber).toMatch(/^TRN-[0-9A-F]{10}$/);
    const [y, m, d] = (done.completedOn as string).split('-').map(Number) as [number, number, number];
    expect(done.expiresOn).toBe(`${y + 1}-${String(m).padStart(2, '0')}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, '0')}`);
    expect((await ctx.http().post(`${API}/training/enrollments/${eid}/attempts`).set(t.asha.h).send({ answers: {} })).status).toBe(409);
    expect((await ctx.http().post(`${API}/training/enrollments/${eid}/feedback`).set(t.asha.h).send({ rating: 5, comment: 'Clear and practical' })).body.data.feedback).toEqual({ rating: 5, comment: 'Clear and practical' });
    expect((await ctx.http().post(`${API}/training/enrollments/${eid}/feedback`).set(t.asha.h).send({ rating: 4 })).status).toBe(409);
    expect((await ctx.http().get(`${API}/training/courses/${id}`).set(t.hr.h)).body.data.feedback).toEqual({ average: 5, count: 1 });

    // Ben runs out of attempts: failed, and may enrol again.
    const benEnrol = (await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.ben.h).send({})).body.data.id;
    await ctx.http().post(`${API}/training/enrollments/${benEnrol}/attempts`).set(t.ben.h).send({ answers: {} });
    const out = await ctx.http().post(`${API}/training/enrollments/${benEnrol}/attempts`).set(t.ben.h).send({ answers: { [q1!.id]: 1 } });
    expect(out.body.data.enrollment).toMatchObject({ status: 'FAILED', attempts: 2, bestScore: 33 });
    expect((await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.ben.h).send({})).status).toBe(201);
    expect((await ctx.http().get(`${API}/training/enrollments/${eid}`).set(t.ben.h)).status).toBe(404);

    // Certification expiring in 10 days shows up for HR and the manager until it's renewed.
    await TrainingEnrollment.update({ expiresOn: addDays(today(), 10) }, { where: { id: eid }, ...RAW });
    const expiring = (await ctx.http().get(`${API}/training/certifications?state=EXPIRING`).set(t.manager.h)).body.data;
    expect(expiring).toEqual([expect.objectContaining({ id: eid, certification: 'EXPIRING' })]);
    await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.asha.h).send({});
    expect((await ctx.http().get(`${API}/training/certifications?state=EXPIRING`).set(t.hr.h)).body.data).toEqual([]);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/training/enrollments/${eid}`).set(oh)).status).toBe(404);
  });

  it('assigns a classroom course by department within scope, with seats and attendance', async () => {
    const t = await team();
    const course = await ctx.http().post(`${API}/training/courses`).set(t.hr.h).send({ code: 'LEAD-1', title: 'First-time managers', category: 'LEADERSHIP', delivery: 'CLASSROOM', selfEnrollment: false });
    const id = course.body.data.id;
    await ctx.http().post(`${API}/training/courses/${id}/publish`).set(t.hr.h).send({});
    const start = new Date(Date.now() + 7 * 86_400_000);
    const withSession = await ctx.http().post(`${API}/training/courses/${id}/sessions`).set(t.hr.h).send({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3 * 3_600_000).toISOString(), location: 'Board room', trainer: 'Priya Nair', capacity: 2 });
    const session = withSession.body.data.sessions[0];
    expect(session).toMatchObject({ capacity: 2, enrolled: 0, seatsLeft: 2 });

    expect((await ctx.http().post(`${API}/training/courses/${id}/enroll`).set(t.asha.h).send({ sessionId: session.id })).status).toBe(403);
    // Engineering has three people but the session only two seats.
    const full = await ctx.http().post(`${API}/training/assignments`).set(t.manager.h).send({ courseId: id, departmentIds: [t.eng.id], sessionId: session.id });
    expect(full.status).toBe(409);
    await ctx.http().patch(`${API}/training/sessions/${session.id}`).set(t.hr.h).send({ capacity: 10 });
    const due = addDays(today(), 30);
    const assigned = await ctx.http().post(`${API}/training/assignments`).set(t.manager.h).send({ courseId: id, departmentIds: [t.eng.id], employeeIds: [t.hr.employee.id], sessionId: session.id, dueDate: due });
    expect(assigned.body.data.assigned).toBe(3);
    expect(assigned.body.data.skipped).toEqual([expect.objectContaining({ employeeId: t.hr.employee.id, reason: 'Not an active employee in your scope' })]);
    expect((await ctx.http().post(`${API}/training/assignments`).set(t.manager.h).send({ courseId: id, employeeIds: [t.asha.employee.id] })).body.data.skipped[0].reason).toBe('Already enrolled');
    expect((await ctx.http().post(`${API}/training/assignments`).set(t.asha.h).send({ courseId: id, employeeIds: [t.ben.employee.id] })).status).toBe(403);

    const teamRows = (await ctx.http().get(`${API}/training/enrollments?view=team`).set(t.manager.h)).body.data as { id: string; employee: { id: string }; dueDate: string; source: string }[];
    expect(teamRows).toHaveLength(3);
    expect(teamRows.every((e) => e.dueDate === due && e.source === 'ASSIGNED')).toBe(true);
    const ashaEnrol = teamRows.find((e) => e.employee.id === t.asha.employee.id)!.id;
    const benEnrol = teamRows.find((e) => e.employee.id === t.ben.employee.id)!.id;
    expect((await ctx.http().post(`${API}/training/enrollments/${ashaEnrol}/cancel`).set(t.asha.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/training/enrollments/${ashaEnrol}`).set(t.asha.h)).body.data).toMatchObject({ requirementsLeft: ['Attend the session'], session: { id: session.id } });

    // Attendance only once the session has started; then attendees complete and absentees are no-shows.
    expect((await ctx.http().put(`${API}/training/sessions/${session.id}/attendance`).set(t.hr.h).send({ entries: [{ enrollmentId: ashaEnrol, attended: true }] })).status).toBe(409);
    await ctx.http().patch(`${API}/training/sessions/${session.id}`).set(t.hr.h).send({ startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), endsAt: new Date(Date.now() - 3_600_000).toISOString() });
    const roster = await ctx.http().put(`${API}/training/sessions/${session.id}/attendance`).set(t.hr.h).send({ entries: [{ enrollmentId: ashaEnrol, attended: true }, { enrollmentId: benEnrol, attended: false }] });
    const byId = new Map((roster.body.data as { id: string; status: string; certificateNumber: string | null; expiresOn: string | null }[]).map((r) => [r.id, r]));
    expect(byId.get(ashaEnrol)).toMatchObject({ status: 'COMPLETED', expiresOn: null, certificateNumber: expect.stringMatching(/^TRN-/) });
    expect(byId.get(benEnrol)).toMatchObject({ status: 'NO_SHOW' });
    expect((await ctx.http().get(`${API}/training/courses/${id}`).set(t.hr.h)).body.data.sessions[0].status).toBe('COMPLETED');
  });
});
