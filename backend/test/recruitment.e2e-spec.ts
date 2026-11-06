import { Candidate, Notification, OnboardingCase, Organization } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('Recruitment (e2e)', () => {
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

  async function adminSession(planCode?: string) {
    const org = await createOrgWithAdmin(ctx, planCode ? { planCode } : {});
    return { ...org, h: bearer((await login(ctx, org.admin.email)).accessToken) };
  }

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  /** An organization with a department manager (requester), an HR manager (approver / hirer), a recruiter and a team lead (interviewer). */
  async function team() {
    const s = await adminSession();
    const eng = (await ctx.http().post(`${API}/departments`).set(s.h).send({ name: 'Engineering' })).body.data;
    const sales = (await ctx.http().post(`${API}/departments`).set(s.h).send({ name: 'Sales' })).body.data;
    const designation = (await ctx.http().post(`${API}/designations`).set(s.h).send({ name: 'Backend Engineer' })).body.data;
    const manager = await person(s.organization.id, s.h, ['department_manager'], { departmentId: eng.id });
    const otherManager = await person(s.organization.id, s.h, ['department_manager'], { departmentId: sales.id });
    const hr = await person(s.organization.id, s.h, ['hr_manager']);
    const recruiter = await person(s.organization.id, s.h, ['recruiter']);
    const interviewer = await person(s.organization.id, s.h, ['team_lead'], { departmentId: eng.id });
    return { ...s, eng, designation, manager, otherManager, hr, recruiter, interviewer };
  }

  async function approvedJob(t: Awaited<ReturnType<typeof team>>, extra: Record<string, unknown> = {}) {
    const req = await ctx.http().post(`${API}/recruitment/requisitions`).set(t.manager.h).send({
      title: 'Backend Engineer', designationId: t.designation.id, reason: 'NEW_ROLE', justification: 'Scaling the payments platform team', openings: 1, budgetMin: 1_200_000, budgetMax: 1_800_000, submit: true,
    });
    expect(req.status).toBe(201);
    await ctx.http().post(`${API}/recruitment/requisitions/${req.body.data.id}/approve`).set(t.hr.h).send({});
    const job = await ctx.http().post(`${API}/recruitment/jobs`).set(t.recruiter.h).send({ requisitionId: req.body.data.id, description: 'Build and run payment services in TypeScript and PostgreSQL.', isPublic: true, ...extra });
    expect(job.status).toBe(201);
    await ctx.http().post(`${API}/recruitment/jobs/${job.body.data.id}/status`).set(t.recruiter.h).send({ status: 'OPEN' });
    return { requisition: req.body.data, job: job.body.data };
  }

  it('routes requisitions to an approver who is not the requester', async () => {
    const t = await team();
    const req = await ctx.http().post(`${API}/recruitment/requisitions`).set(t.manager.h).send({ title: 'QA Engineer', reason: 'REPLACEMENT', justification: 'Replacing a tester who resigned', submit: true });
    expect(req.body.data).toMatchObject({ code: 'REQ-0001', status: 'PENDING_APPROVAL', department: { id: t.eng.id }, hiringManager: { id: t.manager.employee.id } });
    const id = req.body.data.id;

    // The requester cannot approve their own; a manager of another department cannot see it; recruiters cannot approve.
    expect((await ctx.http().post(`${API}/recruitment/requisitions/${id}/approve`).set(t.manager.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/recruitment/requisitions/${id}/approve`).set(t.otherManager.h).send({})).status).toBe(404);
    expect((await ctx.http().get(`${API}/recruitment/requisitions?view=approve`).set(t.otherManager.h)).body.data).toEqual([]);
    expect((await ctx.http().post(`${API}/recruitment/requisitions/${id}/approve`).set(t.recruiter.h).send({})).status).toBe(403);
    // No job before approval.
    expect((await ctx.http().post(`${API}/recruitment/jobs`).set(t.recruiter.h).send({ requisitionId: id, description: 'Testing web and mobile apps end to end.' })).status).toBe(422);

    expect((await ctx.http().post(`${API}/recruitment/requisitions/${id}/reject`).set(t.hr.h).send({})).status).toBe(422);
    const approved = await ctx.http().post(`${API}/recruitment/requisitions/${id}/approve`).set(t.hr.h).send({ note: 'Go ahead' });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    expect(await Notification.count({ where: { userId: t.manager.user.id, type: 'recruitment.requisition' } })).toBe(1);

    const job = await ctx.http().post(`${API}/recruitment/jobs`).set(t.recruiter.h).send({ requisitionId: id, description: 'Testing web and mobile apps end to end.' });
    expect(job.status).toBe(201);
    expect((await ctx.http().post(`${API}/recruitment/jobs`).set(t.recruiter.h).send({ requisitionId: id, description: 'Testing web and mobile apps end to end.' })).status).toBe(409);
    expect((await ctx.http().get(`${API}/recruitment/requisitions?view=mine`).set(t.manager.h)).body.data[0].job).toMatchObject({ id: job.body.data.id, status: 'DRAFT' });
  });

  it('runs the pipeline: candidates, resumes, stages, interviews and panel feedback', async () => {
    const t = await team();
    const { job } = await approvedJob(t);
    const candidate = await ctx.http().post(`${API}/recruitment/candidates`).set(t.recruiter.h).send({ firstName: 'Ravi', lastName: 'Kumar', email: 'Ravi.Kumar@Example.com', phone: '+91 98765 43210', experienceYears: 4.5, source: 'LINKEDIN', jobId: job.id });
    expect(candidate.status).toBe(201);
    expect(candidate.body.data).toMatchObject({ email: 'ravi.kumar@example.com', applications: [expect.objectContaining({ stage: 'APPLIED' })] });
    const appId = candidate.body.data.applications[0].id;

    // Duplicates by email are blocked; by phone they are flagged.
    expect((await ctx.http().post(`${API}/recruitment/candidates`).set(t.recruiter.h).send({ firstName: 'R', lastName: 'K', email: 'ravi.kumar@example.com' })).status).toBe(409);
    expect((await ctx.http().get(`${API}/recruitment/candidates/duplicates?phone=9876543210`).set(t.recruiter.h)).body.data).toEqual([expect.objectContaining({ id: candidate.body.data.id, match: 'PHONE' })]);

    expect((await ctx.http().post(`${API}/recruitment/candidates/${candidate.body.data.id}/resume`).set(t.recruiter.h).attach('file', Buffer.from('not a resume'), 'cv.pdf')).status).toBe(422);
    expect((await ctx.http().post(`${API}/recruitment/candidates/${candidate.body.data.id}/resume`).set(t.recruiter.h).attach('file', PDF, 'Ravi CV.pdf')).body.data.resume).toMatchObject({ fileName: 'Ravi CV.pdf' });

    expect((await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(t.recruiter.h).send({ stage: 'SCREENING' })).body.data.stage).toBe('SCREENING');
    expect((await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(t.recruiter.h).send({ stage: 'HIRED' })).status).toBe(422);

    // Interview with the team lead on the panel (already started, so feedback can be given).
    const scheduled = await ctx.http().post(`${API}/recruitment/applications/${appId}/interviews`).set(t.recruiter.h).send({ roundName: 'Technical round', scheduledAt: new Date(Date.now() - 3_600_000).toISOString(), panelistIds: [t.interviewer.employee.id] });
    expect(scheduled.status).toBe(201);
    expect(scheduled.body.data.stage).toBe('INTERVIEW');
    expect(await Notification.count({ where: { userId: t.interviewer.user.id, type: 'recruitment.interview' } })).toBe(1);
    const mine = (await ctx.http().get(`${API}/recruitment/my-interviews`).set(t.interviewer.h)).body.data;
    expect(mine).toEqual([expect.objectContaining({ roundName: 'Technical round', candidate: expect.objectContaining({ name: 'Ravi Kumar', hasResume: true }), myFeedback: null })]);
    expect((await ctx.http().get(`${API}/recruitment/interviews/${mine[0].id}/resume`).set(t.interviewer.h)).status).toBe(200);
    // Interviewers cannot browse the candidate database or other people's interviews.
    expect((await ctx.http().get(`${API}/recruitment/candidates`).set(t.interviewer.h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/recruitment/interviews/${mine[0].id}/feedback`).set(t.manager.h).send({ rating: 4, recommendation: 'HIRE', feedback: 'Strong system design skills' })).status).toBe(404);

    const fb = await ctx.http().post(`${API}/recruitment/interviews/${mine[0].id}/feedback`).set(t.interviewer.h).send({ rating: 4, recommendation: 'HIRE', feedback: 'Strong system design skills' });
    expect(fb.body.data.myFeedback).toMatchObject({ rating: 4, recommendation: 'HIRE' });
    expect((await ctx.http().post(`${API}/recruitment/interviews/${mine[0].id}/feedback`).set(t.interviewer.h).send({ rating: 1, recommendation: 'NO_HIRE', feedback: 'Changed my mind later' })).status).toBe(409);
    const detail = (await ctx.http().get(`${API}/recruitment/applications/${appId}`).set(t.recruiter.h)).body.data;
    expect(detail.interviews[0]).toMatchObject({ status: 'COMPLETED', panel: [expect.objectContaining({ rating: 4, recommendation: 'HIRE' })] });
    expect(detail.events.map((e: { toStage: string }) => e.toStage)).toEqual(['APPLIED', 'SCREENING', 'INTERVIEW']);
    expect((await ctx.http().get(`${API}/recruitment/applications?jobId=${job.id}`).set(t.recruiter.h)).body.data[0]).toMatchObject({ averageRating: 4, feedbackCount: 1 });

    expect((await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(t.recruiter.h).send({ stage: 'REJECTED' })).status).toBe(422);
  });

  it('makes an offer and hires the candidate into an employee with onboarding', async () => {
    const t = await team();
    const { job, requisition } = await approvedJob(t);
    const c = (await ctx.http().post(`${API}/recruitment/candidates`).set(t.recruiter.h).send({ firstName: 'Meera', lastName: 'Iyer', email: 'meera@example.com', phone: '+91 90000 11111', jobId: job.id })).body.data;
    const appId = c.applications[0].id;
    expect((await ctx.http().post(`${API}/recruitment/applications/${appId}/offers`).set(t.recruiter.h).send({ annualCtc: 1_500_000, joiningDate: future(30) })).status).toBe(409);
    await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(t.recruiter.h).send({ stage: 'OFFER' });

    const offer = await ctx.http().post(`${API}/recruitment/applications/${appId}/offers`).set(t.recruiter.h).send({ annualCtc: 1_500_000, joiningDate: future(30), expiresOn: future(7) });
    expect(offer.body.data).toMatchObject({ status: 'DRAFT', annualCtc: 1_500_000, designation: { id: t.designation.id }, department: { id: t.eng.id } });
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/hire`).set(t.hr.h).send({})).status).toBe(409);
    await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/release`).set(t.recruiter.h);
    // With a released offer, the candidate cannot be moved away.
    expect((await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(t.recruiter.h).send({ stage: 'REJECTED', note: 'x' })).status).toBe(409);
    await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/response`).set(t.recruiter.h).send({ response: 'ACCEPTED' });

    // Hiring creates an employee, so it needs employee.create (the recruiter has none).
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/hire`).set(t.recruiter.h).send({})).status).toBe(403);
    const hired = await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/hire`).set(t.hr.h).send({ startOnboarding: true });
    expect(hired.status).toBe(201);
    expect(hired.body.data).toMatchObject({ employeeCode: expect.stringMatching(/^EMP-/), onboardingCaseId: expect.any(String), onboardingError: null });
    const employee = (await ctx.http().get(`${API}/employees/${hired.body.data.employeeId}`).set(t.h)).body.data;
    expect(employee).toMatchObject({ fullName: 'Meera Iyer', personalEmail: 'meera@example.com', department: { id: t.eng.id }, designation: { id: t.designation.id }, manager: { id: t.manager.employee.id } });
    expect(await OnboardingCase.count({ where: { employeeId: employee.id }, ...RAW })).toBe(1);

    const app = (await ctx.http().get(`${API}/recruitment/applications/${appId}`).set(t.recruiter.h)).body.data;
    expect(app).toMatchObject({ stage: 'HIRED', hiredEmployeeId: employee.id });
    const req = (await ctx.http().get(`${API}/recruitment/requisitions/${requisition.id}`).set(t.manager.h)).body.data;
    expect(req).toMatchObject({ status: 'FILLED', hiredCount: 1, job: { status: 'CLOSED' } });
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.body.data.id}/hire`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().delete(`${API}/recruitment/candidates/${c.id}`).set(t.recruiter.h)).status).toBe(409);
  });

  it('accepts applications from the public careers page', async () => {
    const t = await team();
    const { job } = await approvedJob(t);
    const slug = (await Organization.findByPk(t.organization.id))!.slug;

    const page = await ctx.http().get(`${API}/careers/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body.data.jobs).toEqual([expect.objectContaining({ id: job.id, title: 'Backend Engineer', department: expect.objectContaining({ name: 'Engineering' }) })]);
    expect((await ctx.http().get(`${API}/careers/${slug}/jobs/${job.id}`)).body.data.job.description).toContain('payment services');
    expect((await ctx.http().get(`${API}/careers/no-such-org`)).status).toBe(404);

    const form = (consent: string) => ctx.http().post(`${API}/careers/${slug}/jobs/${job.id}/apply`).field('firstName', 'Asha').field('lastName', 'Rao').field('email', 'asha.rao@example.com').field('consent', consent);
    expect((await form('false').attach('file', PDF, 'asha.pdf')).status).toBe(422);
    expect((await form('true')).status).toBe(422);
    const applied = await form('true').attach('file', PDF, 'asha.pdf');
    expect(applied.status).toBe(201);
    expect(applied.body.data.received).toBe(true);
    // Applying again gives the same answer and creates nothing new.
    expect((await form('true').attach('file', PDF, 'asha.pdf')).body.data.received).toBe(true);
    const candidates = await Candidate.findAll({ where: { organizationId: t.organization.id }, ...RAW });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ source: 'CAREERS', email: 'asha.rao@example.com' });
    expect(candidates[0]!.consentAt).toBeTruthy();
    expect((await ctx.http().get(`${API}/recruitment/applications?jobId=${job.id}`).set(t.recruiter.h)).body.data).toEqual([expect.objectContaining({ source: 'CAREERS', stage: 'APPLIED' })]);
    expect(await Notification.count({ where: { userId: t.recruiter.user.id, type: 'recruitment.application' } })).toBe(1);

    // Closed jobs and organizations without recruitment are not served.
    await ctx.http().post(`${API}/recruitment/jobs/${job.id}/status`).set(t.recruiter.h).send({ status: 'CLOSED' });
    expect((await ctx.http().get(`${API}/careers/${slug}/jobs/${job.id}`)).status).toBe(404);
    const starter = await adminSession('starter');
    expect((await ctx.http().get(`${API}/careers/${(await Organization.findByPk(starter.organization.id))!.slug}`)).status).toBe(404);
    expect((await ctx.http().get(`${API}/recruitment/requisitions`).set(starter.h)).status).toBe(403);
  });
});
