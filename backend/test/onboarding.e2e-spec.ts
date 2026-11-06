import { Employee, Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

describe('Onboarding & probation (e2e)', () => {
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
    return { ...org, h: bearer((await login(ctx, org.admin.email)).accessToken) };
  }

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2026-01-05', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  const template = (h: Record<string, string>) =>
    ctx.http().post(`${API}/onboarding/templates`).set(h).send({
      name: 'Engineering joiners',
      isDefault: true,
      tasks: [
        { title: 'Complete your profile', assignee: 'EMPLOYEE', dueOffsetDays: 2 },
        { title: 'Plan the first week', assignee: 'MANAGER', dueOffsetDays: -2 },
        { title: 'Create accounts', assignee: 'HR', dueOffsetDays: -1 },
        { title: 'Upload PAN card', assignee: 'EMPLOYEE', documentCategory: 'IDENTITY', dueOffsetDays: 0 },
        { title: 'Upload relieving letter', assignee: 'EMPLOYEE', documentCategory: 'EXPERIENCE', isRequired: false },
      ],
    });

  it('manages checklist templates', async () => {
    const { h } = await adminSession();
    const rec = await ctx.http().post(`${API}/onboarding/templates/recommended`).set(h);
    expect(rec.status).toBe(201);
    expect(rec.body.data).toMatchObject({ name: 'Standard onboarding', isDefault: true });
    expect(rec.body.data.tasks.length).toBeGreaterThan(8);
    expect((await ctx.http().post(`${API}/onboarding/templates/recommended`).set(h)).body.data.id).toBe(rec.body.data.id);
    expect((await ctx.http().post(`${API}/onboarding/templates`).set(h).send({ name: 'Bad', tasks: [{ title: 'Upload X', assignee: 'HR', documentCategory: 'IDENTITY' }] })).status).toBe(422);

    const custom = await template(h);
    expect(custom.status).toBe(201);
    const list = (await ctx.http().get(`${API}/onboarding/templates`).set(h)).body.data;
    // Only one default at a time.
    expect(list.filter((t: { isDefault: boolean }) => t.isDefault).map((t: { name: string }) => t.name)).toEqual(['Engineering joiners']);
    const updated = await ctx.http().put(`${API}/onboarding/templates/${custom.body.data.id}`).set(h).send({ tasks: [{ title: 'Only task', assignee: 'HR' }] });
    expect(updated.body.data.tasks.map((t: { title: string }) => t.title)).toEqual(['Only task']);
  });

  it('runs a checklist: each assignee completes their own tasks, documents are verified, then HR completes it', async () => {
    const { organization, h } = await adminSession();
    await template(h);
    const lead = await person(organization.id, h, ['team_lead']);
    const joiner = await person(organization.id, h, ['employee'], { managerId: lead.employee.id, dateOfJoining: '2026-11-02' });
    const other = await person(organization.id, h, ['employee']);

    expect((await ctx.http().get(`${API}/onboarding/joiners`).set(h)).body.data.map((j: { id: string }) => j.id)).toContain(joiner.employee.id);
    const started = await ctx.http().post(`${API}/onboarding/cases`).set(h).send({ employeeId: joiner.employee.id, buddyId: other.employee.id });
    expect(started.status).toBe(201);
    const caseId = started.body.data.id;
    expect(started.body.data.tasks).toHaveLength(5);
    expect(started.body.data.tasks.find((t: { title: string }) => t.title === 'Plan the first week').dueDate).toBe('2026-10-31');
    expect((await ctx.http().post(`${API}/onboarding/cases`).set(h).send({ employeeId: joiner.employee.id })).status).toBe(409);
    expect((await ctx.http().get(`${API}/onboarding/joiners`).set(h)).body.data.map((j: { id: string }) => j.id)).not.toContain(joiner.employee.id);
    for (const u of [joiner.user.id, lead.user.id, other.user.id]) expect(await Notification.count({ where: { userId: u, type: 'onboarding' } })).toBe(1);

    const mine = (await ctx.http().get(`${API}/onboarding/me`).set(joiner.h)).body.data;
    expect(mine).toMatchObject({ id: caseId, permissions: { isSelf: true, manage: false } });
    const task = (title: string) => mine.tasks.find((t: { title: string }) => t.title === title).id as string;

    // Each assignee does their own part only.
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Create accounts')}/complete`).set(joiner.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Plan the first week')}/complete`).set(joiner.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Complete your profile')}/complete`).set(joiner.h).send({})).status).toBe(201);
    const teamTasks = (await ctx.http().get(`${API}/onboarding/team-tasks`).set(lead.h)).body.data;
    expect(teamTasks[0]).toMatchObject({ caseId, employee: { id: joiner.employee.id } });
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Plan the first week')}/complete`).set(lead.h).send({ note: 'Done' })).status).toBe(201);
    expect((await ctx.http().get(`${API}/onboarding/cases/${caseId}`).set(other.h)).status).toBe(404);

    // Documents: the joiner uploads, cannot verify; HR verifies and the task completes.
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Upload PAN card')}/complete`).set(joiner.h).send({})).status).toBe(422);
    const uploaded = await ctx.http().post(`${API}/onboarding/tasks/${task('Upload PAN card')}/document`).set(joiner.h).attach('file', PDF, 'pan.pdf');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.tasks.find((t: { title: string }) => t.title === 'Upload PAN card')).toMatchObject({ state: 'SUBMITTED', document: { status: 'PENDING', fileName: 'pan.pdf' } });
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Upload PAN card')}/verify`).set(joiner.h).send({ status: 'VERIFIED' })).status).toBe(403);

    // HR cannot finish while required tasks are open.
    expect((await ctx.http().post(`${API}/onboarding/cases/${caseId}/complete`).set(h)).status).toBe(422);
    const hrView = (await ctx.http().get(`${API}/onboarding/cases/${caseId}`).set(h)).body.data;
    expect(hrView.progress).toMatchObject({ total: 5, done: 2, awaitingVerification: 1 });
    expect((await ctx.http().get(`${API}/onboarding/tasks/${task('Upload PAN card')}/document`).set(h)).status).toBe(200);
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Upload PAN card')}/verify`).set(h).send({ status: 'REJECTED' })).status).toBe(422);
    const verified = await ctx.http().post(`${API}/onboarding/tasks/${task('Upload PAN card')}/verify`).set(h).send({ status: 'VERIFIED' });
    expect(verified.body.data.tasks.find((t: { title: string }) => t.title === 'Upload PAN card').state).toBe('DONE');
    expect((await ctx.http().get(`${API}/employees/${joiner.employee.id}/documents`).set(h)).body.data[0]).toMatchObject({ status: 'VERIFIED', category: 'IDENTITY' });

    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Create accounts')}/skip`).set(h).send({})).status).toBe(422);
    await ctx.http().post(`${API}/onboarding/tasks/${task('Create accounts')}/complete`).set(h).send({});
    // The optional relieving letter does not block completion.
    const done = await ctx.http().post(`${API}/onboarding/cases/${caseId}/complete`).set(h);
    expect(done.status).toBe(201);
    expect(done.body.data.status).toBe('COMPLETED');
    expect((await ctx.http().post(`${API}/onboarding/tasks/${task('Complete your profile')}/reopen`).set(joiner.h)).status).toBe(409);
    expect((await ctx.http().get(`${API}/onboarding/cases?status=COMPLETED`).set(h)).body.data.map((c: { id: string }) => c.id)).toEqual([caseId]);

    // Another organization sees nothing.
    const b = await adminSession();
    expect((await ctx.http().get(`${API}/onboarding/cases/${caseId}`).set(b.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/onboarding/cases`).set(b.h)).body.data).toEqual([]);
  });

  it('confirms and extends probation with segregation of duties', async () => {
    const { organization, h } = await adminSession();
    const hr = await person(organization.id, h, ['hr_manager']);
    const lead = await person(organization.id, h, ['team_lead']);
    const joiner = await person(organization.id, h, ['employee'], { managerId: lead.employee.id, dateOfJoining: '2025-01-06', probationEndDate: '2025-07-05' });
    const second = await person(organization.id, h, ['employee'], { dateOfJoining: '2026-06-01', probationEndDate: '2026-11-30' });

    const due = (await ctx.http().get(`${API}/onboarding/probation?days=60`).set(lead.h)).body.data;
    expect(due).toEqual([expect.objectContaining({ employee: expect.objectContaining({ id: joiner.employee.id }), isDirectReport: true, pendingReview: null })]);
    expect((await ctx.http().get(`${API}/onboarding/probation?days=60`).set(h)).body.data.map((d: { employee: { id: string } }) => d.employee.id)).toEqual(expect.arrayContaining([joiner.employee.id, second.employee.id]));

    // The manager recommends; they cannot decide; HR decides.
    expect((await ctx.http().post(`${API}/onboarding/probation/reviews`).set(joiner.h).send({ employeeId: joiner.employee.id, recommendation: 'CONFIRM', comments: 'I did well in probation' })).status).toBe(403);
    const review = await ctx.http().post(`${API}/onboarding/probation/reviews`).set(lead.h).send({ employeeId: joiner.employee.id, recommendation: 'CONFIRM', comments: 'Consistently strong delivery and teamwork' });
    expect(review.status).toBe(201);
    expect((await ctx.http().post(`${API}/onboarding/probation/reviews`).set(lead.h).send({ employeeId: joiner.employee.id, recommendation: 'CONFIRM', comments: 'Duplicate recommendation here' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/onboarding/probation/reviews/${review.body.data.id}/approve`).set(lead.h).send({})).status).toBe(403);
    const toApprove = (await ctx.http().get(`${API}/onboarding/probation/reviews?status=PENDING`).set(hr.h)).body.data;
    expect(toApprove.map((r: { id: string }) => r.id)).toEqual([review.body.data.id]);
    const approved = await ctx.http().post(`${API}/onboarding/probation/reviews/${review.body.data.id}/approve`).set(hr.h).send({ note: 'Welcome aboard' });
    expect(approved.body.data.status).toBe('APPROVED');
    const confirmed = await Employee.findByPk(joiner.employee.id, RAW);
    expect(confirmed!.confirmedOn).toBe('2025-07-05');
    const history = (await ctx.http().get(`${API}/employees/${joiner.employee.id}/history`).set(h)).body.data;
    expect(history[0]).toMatchObject({ type: 'CONFIRMATION', effectiveDate: '2025-07-05' });
    expect(await Notification.count({ where: { userId: joiner.user.id, type: 'probation' } })).toBe(1);
    expect(await Notification.count({ where: { userId: lead.user.id, type: 'probation' } })).toBe(1);
    expect((await ctx.http().get(`${API}/onboarding/probation?days=60`).set(lead.h)).body.data).toEqual([]);

    // Whoever recommends cannot also approve (HR recommending must be approved by someone else).
    const extend = await ctx.http().post(`${API}/onboarding/probation/reviews`).set(h).send({ employeeId: second.employee.id, recommendation: 'EXTEND', extendTo: '2027-02-28', comments: 'Needs more time on core skills' });
    expect(extend.status).toBe(201);
    expect((await ctx.http().post(`${API}/onboarding/probation/reviews/${extend.body.data.id}/approve`).set(h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/onboarding/probation/reviews/${extend.body.data.id}/reject`).set(hr.h).send({})).status).toBe(422);
    await ctx.http().post(`${API}/onboarding/probation/reviews/${extend.body.data.id}/approve`).set(hr.h).send({});
    const extended = (await ctx.http().get(`${API}/employees/${second.employee.id}`).set(h)).body.data;
    expect(extended).toMatchObject({ probationEndDate: '2027-02-28', confirmedOn: null });
    expect((await ctx.http().get(`${API}/employees/${second.employee.id}/history`).set(h)).body.data[0]).toMatchObject({ type: 'PROBATION_EXTENDED', changes: { probationEndDate: { from: '2026-11-30', to: '2027-02-28' } } });

    // Confirming through a lifecycle action also records confirmedOn, and only once.
    const viaLifecycle = await ctx.http().post(`${API}/employees/${second.employee.id}/lifecycle`).set(h).send({ type: 'CONFIRMATION', effectiveDate: '2026-11-02' });
    expect(viaLifecycle.body.data.confirmedOn).toBe('2026-11-02');
    expect((await ctx.http().post(`${API}/employees/${second.employee.id}/lifecycle`).set(h).send({ type: 'CONFIRMATION', effectiveDate: '2026-11-03' })).status).toBe(409);
  });
});
