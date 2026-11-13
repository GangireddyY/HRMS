import { ApprovalInstance, LeaveLedgerEntry, MembershipRole, Notification, Permission, Role, RolePermission } from '../src/database/models';
import { ApprovalSlaJob } from '../src/modules/approvals/approval-sla.job';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';
import { addDays } from '../src/common/utils/zoned-time';

/** The Monday `weeks` weeks after next (a run of working days). */
function monday(weeks: number): string {
  const today = orgToday();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, ((8 - dow) % 7 || 7) + 7 * weeks);
}

describe('Approval chains (e2e)', () => {
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
    async function person(roles: string[], extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roles);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, membership, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const hr = await person(['hr_manager']);
    const manager = await person(['department_manager'], { departmentId: eng.id });
    const ravi = await person(['employee'], { departmentId: eng.id });
    const asha = await person(['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    const type = (await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'CL', name: 'Casual leave', annualQuota: 24, accrualFrequency: 'YEARLY' })).body.data;
    return { ...org, h, hr, manager, ravi, asha, type };
  }

  /** Gives the person a role with just this approve permission (team scope) and signs them in again. */
  async function grant(orgId: string, p: { membership: { id: string }; user: { email: string }; h: Record<string, string> }, key: string) {
    const roleKey = `approver_${key.replace(/\W/g, '_')}`;
    let role = await Role.findOne({ where: { organizationId: orgId, key: roleKey }, ...RAW });
    if (!role) {
      role = await Role.create({ organizationId: orgId, key: roleKey, name: `Approver (${key})` }, RAW);
      const permission = (await Permission.findOne({ where: { key }, ...RAW }))!;
      await RolePermission.create({ organizationId: orgId, roleId: role.id, permissionId: permission.id, scope: 'TEAM' }, RAW);
    }
    const link = await MembershipRole.create({ organizationId: orgId, membershipId: p.membership.id, roleId: role.id }, RAW);
    p.h = bearer((await login(ctx, p.user.email)).accessToken);
    return link;
  }

  /** A chain naming someone without the approve permission is refused. */
  async function refusesUnentitled(h: Record<string, string>, subject: string, membershipId: string) {
    const res = await ctx.http().post(`${API}/approvals/chains`).set(h).send({ subject, name: 'Named', steps: [{ label: 'Named', approver: 'USER', membershipId }] });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error)).toMatch(/permission/);
  }

  it('routes leave through a configured chain: steps in order, outside-scope approvers, rejection', async () => {
    const s = await setup();
    // Configuring chains needs approvals.configure; steps are validated.
    expect((await ctx.http().get(`${API}/approvals/chains`).set(s.asha.h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({ subject: 'LEAVE', name: 'Bad', steps: [{ label: 'HR', approver: 'PERMISSION' }] })).status).toBe(422);
    // A named approver must hold the leave approve permission (any scope).
    await refusesUnentitled(s.h, 'LEAVE', s.ravi.membership.id);
    const raviRole = await grant(s.organization.id, s.ravi, 'leave.approve');
    const created = await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({
      subject: 'LEAVE',
      name: 'Long leave',
      conditions: { minDays: 3 },
      steps: [
        { label: 'Manager', approver: 'MANAGER', slaHours: 24 },
        { label: 'HR', approver: 'PERMISSION', permission: 'leave.approve' },
        { label: 'Project lead', approver: 'USER', membershipId: s.ravi.membership.id },
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body.data.steps[2].approverName).toContain('Person');

    const apply = (start: string, end: string) => ctx.http().post(`${API}/leave/requests`).set(s.asha.h).send({ leaveTypeId: s.type.id, startDate: start, endDate: end, reason: 'Family trip' });
    // A short request doesn't match: the leave type's single level applies.
    const short = (await apply(monday(1), monday(1))).body.data;
    expect(short.approval.chain).toBeNull();
    expect((await ctx.http().post(`${API}/leave/requests/${short.id}/approve`).set(s.manager.h).send({})).body.data.status).toBe('APPROVED');

    const long = (await apply(monday(2), addDays(monday(2), 4))).body.data;
    expect(long.approval).toMatchObject({ levels: 3, awaiting: 'Manager', chain: { chain: 'Long leave', currentStep: 0 } });
    expect(long.approval.chain.steps.map((x: { label: string; state: string }) => `${x.label}:${x.state}`)).toEqual(['Manager:current', 'HR:upcoming', 'Project lead:upcoming']);
    expect(await Notification.count({ where: { userId: s.manager.user.id, type: 'leave.request' }, ...RAW })).toBe(2);

    // HR (organization-wide leave approver) can't skip the manager, and doesn't see it as waiting for them yet.
    expect((await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.hr.h).send({})).body.error.message).toMatch(/waiting for Manager/);
    const team = async (h: Record<string, string>) => (await ctx.http().get(`${API}/leave/requests?view=team&status=PENDING`).set(h)).body.data as { id: string; canApprove: boolean }[];
    expect((await team(s.hr.h)).map((r) => r.id)).not.toContain(long.id);
    expect((await team(s.manager.h)).find((r) => r.id === long.id)?.canApprove).toBe(true);

    expect((await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.manager.h).send({ note: 'Fine by me' })).body.data.approval).toMatchObject({ awaiting: 'HR', level: 2 });
    expect((await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.manager.h).send({})).status).toBe(403);
    expect(await Notification.count({ where: { userId: s.hr.user.id, type: 'leave.request' }, ...RAW })).toBeGreaterThan(0);
    expect((await team(s.hr.h)).find((r) => r.id === long.id)?.canApprove).toBe(true);
    await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.hr.h).send({});

    // The named person decides the last step for someone outside their team; losing the permission stops them.
    expect((await team(s.ravi.h)).map((r) => r.id)).toEqual([long.id]);
    await MembershipRole.destroy({ where: { id: raviRole.id }, ...RAW });
    s.ravi.h = bearer((await login(ctx, s.ravi.user.email)).accessToken);
    expect((await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.ravi.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/approvals/waiting`).set(s.ravi.h)).body.data).toEqual([]);
    await MembershipRole.create({ organizationId: s.organization.id, membershipId: s.ravi.membership.id, roleId: raviRole.roleId }, RAW);
    s.ravi.h = bearer((await login(ctx, s.ravi.user.email)).accessToken);
    const done = (await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(s.ravi.h).send({})).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.approval.chain.decisions.map((d: { decision: string }) => d.decision)).toEqual(['APPROVED', 'APPROVED', 'APPROVED']);
    expect(await LeaveLedgerEntry.count({ where: { leaveRequestId: long.id, kind: 'TAKEN' }, ...RAW })).toBe(1);

    // Rejection at any step ends the chain.
    const third = (await apply(monday(4), addDays(monday(4), 4))).body.data;
    const rejected = (await ctx.http().post(`${API}/leave/requests/${third.id}/reject`).set(s.manager.h).send({ note: 'Release week' })).body.data;
    expect(rejected.status).toBe('REJECTED');
    expect((await ApprovalInstance.findOne({ where: { subjectId: third.id }, ...RAW }))!.status).toBe('REJECTED');
  });

  it('routes large expense claims through manager, finance and a named approver', async () => {
    const s = await setup();
    const finance = await (async () => {
      const user = await createUser(ctx, { email: uniqueEmail('fin'), lastName: 'Person' });
      const membership = await addMember(ctx, s.organization.id, user.id, ['finance_manager']);
      await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id });
      return { user, membership, h: bearer((await login(ctx, user.email)).accessToken) };
    })();
    await refusesUnentitled(s.h, 'EXPENSE', s.ravi.membership.id);
    await grant(s.organization.id, s.ravi, 'payroll.reimbursement.approve');
    await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({
      subject: 'EXPENSE',
      name: 'Large claims',
      conditions: { minAmount: 5000 },
      steps: [
        { label: 'Manager', approver: 'MANAGER' },
        { label: 'Finance', approver: 'PERMISSION', permission: 'payroll.reimbursement.finance' },
        { label: 'Budget owner', approver: 'USER', membershipId: s.ravi.membership.id },
      ],
    });
    const claim = (amount: number) => ctx.http().post(`${API}/payroll/reimbursements`).set(s.asha.h).field('category', 'TRAVEL').field('title', `Taxi ${amount}`).field('expenseDate', addDays(orgToday(), -3)).field('amount', String(amount));

    // Below the chain's amount: the manager's approval settles it.
    const small = (await claim(2000)).body.data;
    expect(small.chain).toBeNull();
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${small.id}/approve`).set(s.manager.h).send({})).body.data.status).toBe('APPROVED');

    const big = (await claim(9000)).body.data;
    expect(big.chain.steps.map((x: { label: string }) => x.label)).toEqual(['Manager', 'Finance', 'Budget owner']);
    const pay = (h: Record<string, string>) => ctx.http().post(`${API}/payroll/reimbursements/${big.id}/approve`).set(h).send({});
    expect((await pay(finance.h)).body.error.message).toMatch(/waiting for Manager/);
    expect((await ctx.http().get(`${API}/payroll/reimbursements?view=finance`).set(finance.h)).body.data.map((c: { id: string }) => c.id)).not.toContain(big.id);
    expect((await pay(s.manager.h)).body.data).toMatchObject({ status: 'PENDING', chain: { currentStep: 1 } });
    const financeQueue = (await ctx.http().get(`${API}/payroll/reimbursements?view=approve`).set(finance.h)).body.data as { id: string; permissions: { review: boolean } }[];
    expect(financeQueue.find((c) => c.id === big.id)?.permissions.review).toBe(true);
    expect((await pay(finance.h)).body.data.chain.currentStep).toBe(2);
    // The named budget owner (claim approver for their own team only) can open and approve it.
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${big.id}`).set(s.ravi.h)).status).toBe(200);
    const done = (await pay(s.ravi.h)).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.chain.decisions).toHaveLength(3);
    // Once settled, the named approver has no rights over the claim (outside their team, it isn't even visible).
    expect((await pay(s.ravi.h)).status).toBe(404);
    expect((await pay(s.manager.h)).status).toBe(409);
  });

  it('escalates a step past its deadline to the organization-wide approvers', async () => {
    const s = await setup();
    await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({ subject: 'LEAVE', name: 'Everything', steps: [{ label: 'Manager', approver: 'MANAGER', slaHours: 24 }] });
    const req = (await ctx.http().post(`${API}/leave/requests`).set(s.asha.h).send({ leaveTypeId: s.type.id, startDate: monday(3), endDate: monday(3), reason: 'Errand' })).body.data;
    expect((await ctx.http().post(`${API}/leave/requests/${req.id}/approve`).set(s.hr.h).send({})).status).toBe(403);

    const job = ctx.app.get(ApprovalSlaJob);
    expect(await job.tick(new Date(Date.now() + 23 * 3_600_000))).toBe(0);
    expect(await job.tick(new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect(await job.tick(new Date(Date.now() + 26 * 3_600_000))).toBe(0);
    const instance = (await ApprovalInstance.findOne({ where: { subjectId: req.id }, ...RAW }))!;
    expect(instance.escalatedAt).not.toBeNull();
    expect(instance.steps[0]!.escalatedMembershipIds).toContain(s.hr.membership.id);
    expect(await Notification.count({ where: { userId: s.manager.user.id, type: 'approvals.escalated' }, ...RAW })).toBe(1);

    const approved = (await ctx.http().post(`${API}/leave/requests/${req.id}/approve`).set(s.hr.h).send({})).body.data;
    expect(approved.status).toBe('APPROVED');
    expect(approved.approval.chain.escalated).toBe(true);
  });

  it('routes expensive travel through the manager and a named approver', async () => {
    const s = await setup();
    await refusesUnentitled(s.h, 'TRAVEL', s.ravi.membership.id);
    await grant(s.organization.id, s.ravi, 'travel.approve');
    await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({
      subject: 'TRAVEL',
      name: 'Costly trips',
      conditions: { minAmount: 50_000 },
      steps: [
        { label: 'Manager', approver: 'MANAGER' },
        { label: 'Budget owner', approver: 'USER', membershipId: s.ravi.membership.id },
      ],
    });
    const trip = (cost: number) =>
      ctx.http().post(`${API}/travel/requests`).set(s.asha.h).send({ purpose: 'Client workshop', fromCity: 'Pune', toCity: 'Delhi', departureDate: monday(2), returnDate: addDays(monday(2), 2), mode: 'FLIGHT', estimatedCost: cost });
    const cheap = (await trip(12_000)).body.data;
    expect(cheap.chain).toBeNull();
    expect((await ctx.http().post(`${API}/travel/requests/${cheap.id}/approve`).set(s.manager.h).send({})).body.data.status).toBe('APPROVED');

    const big = (await trip(80_000)).body.data;
    expect(big.chain.steps.map((x: { label: string }) => x.label)).toEqual(['Manager', 'Budget owner']);
    // The named approver (travel approver for their own team only) sees nothing until it's their step.
    const queue = async (h: Record<string, string>) => ((await ctx.http().get(`${API}/travel/requests?view=team&status=PENDING`).set(h)).body.data as { id: string }[]).map((r) => r.id);
    expect(await queue(s.ravi.h)).toEqual([]);
    expect((await ctx.http().post(`${API}/travel/requests/${big.id}/approve`).set(s.ravi.h).send({})).status).toBe(404);
    expect((await ctx.http().post(`${API}/travel/requests/${big.id}/approve`).set(s.manager.h).send({})).body.data).toMatchObject({ status: 'PENDING', chain: { currentStep: 1 } });
    expect(await queue(s.ravi.h)).toEqual([big.id]);
    // "My approvals" lists it with what's needed to decide, across kinds of request.
    const inbox = (await ctx.http().get(`${API}/approvals/waiting`).set(s.ravi.h)).body.data;
    expect(inbox).toEqual([expect.objectContaining({ subject: 'TRAVEL', subjectId: big.id, step: 'Budget owner', stepNumber: 2, steps: 2, title: 'Pune to Delhi', amount: 80_000, onBehalf: false })]);
    expect(inbox[0].person).toContain('Person');
    expect((await ctx.http().get(`${API}/approvals/waiting`).set(s.manager.h)).body.data).toEqual([]);
    expect((await ctx.http().get(`${API}/travel/requests/${big.id}`).set(s.ravi.h)).body.data.permissions.approve).toBe(true);
    const done = (await ctx.http().post(`${API}/travel/requests/${big.id}/approve`).set(s.ravi.h).send({ note: 'Within budget' })).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.chain.decisions).toHaveLength(2);
  });

  it('accepts a resignation step by step on a chain; the last step sets the last working day', async () => {
    const s = await setup();
    await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({
      subject: 'EXIT',
      name: 'Resignations',
      steps: [
        { label: 'Manager', approver: 'MANAGER' },
        { label: 'HR', approver: 'PERMISSION', permission: 'exit.manage' },
      ],
    });
    const resigned = (await ctx.http().post(`${API}/exits/resign`).set(s.asha.h).send({ reason: 'BETTER_OPPORTUNITY' })).body.data;
    expect(resigned.chain).toMatchObject({ chain: 'Resignations', currentStep: 0 });
    const lastDay = addDays(orgToday(), 30);
    const accept = (h: Record<string, string>) => ctx.http().post(`${API}/exits/${resigned.id}/approve`).set(h).send({ lastWorkingDay: lastDay });
    const queue = async (h: Record<string, string>) => ((await ctx.http().get(`${API}/exits?view=approve`).set(h)).body.data as { id: string }[]).map((r) => r.id);

    // HR can't accept before the manager, and it isn't in their queue yet.
    expect(await queue(s.hr.h)).not.toContain(resigned.id);
    expect((await accept(s.hr.h)).body.error.message).toMatch(/waiting for Manager/);
    expect(await queue(s.manager.h)).toEqual([resigned.id]);
    expect((await ctx.http().get(`${API}/approvals/waiting`).set(s.manager.h)).body.data).toEqual([expect.objectContaining({ subject: 'EXIT', title: 'Resignation', suggestedDate: resigned.noticeEndsOn })]);
    const step = (await accept(s.manager.h)).body.data;
    expect(step).toMatchObject({ status: 'SUBMITTED', lastWorkingDay: null, chain: { currentStep: 1 } });
    expect(await queue(s.hr.h)).toEqual([resigned.id]);
    const done = (await accept(s.hr.h)).body.data;
    expect(done).toMatchObject({ status: 'APPROVED', lastWorkingDay: lastDay, chain: { status: 'APPROVED' } });
    expect((await ctx.http().get(`${API}/employees/${s.asha.employee.id}`).set(s.h)).body.data.status).toBe('ON_NOTICE');

    // Withdrawing a resignation closes its chain.
    const again = (await ctx.http().post(`${API}/exits/resign`).set(s.ravi.h).send({ reason: 'PERSONAL' })).body.data;
    await ctx.http().post(`${API}/exits/${again.id}/withdraw`).set(s.ravi.h);
    expect((await ApprovalInstance.findOne({ where: { subjectId: again.id }, ...RAW }))?.status ?? 'CANCELLED').toBe('CANCELLED');
  });

  it('requires and runs offer approval through a chain (hiring manager, then a named approver)', async () => {
    const s = await setup();
    const designation = (await ctx.http().post(`${API}/designations`).set(s.h).send({ name: 'Backend Engineer' })).body.data;
    const recruiter = await (async () => {
      const user = await createUser(ctx, { email: uniqueEmail('rec'), lastName: 'Person' });
      const membership = await addMember(ctx, s.organization.id, user.id, ['recruiter']);
      await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id });
      return { user, h: bearer((await login(ctx, user.email)).accessToken) };
    })();
    const req = (
      await ctx.http().post(`${API}/recruitment/requisitions`).set(s.manager.h).send({ title: 'Backend Engineer', designationId: designation.id, reason: 'NEW_ROLE', justification: 'Scaling the payments platform team', openings: 1, budgetMax: 3_000_000, submit: true })
    ).body.data;
    await ctx.http().post(`${API}/recruitment/requisitions/${req.id}/approve`).set(s.hr.h).send({});
    const job = (await ctx.http().post(`${API}/recruitment/jobs`).set(recruiter.h).send({ requisitionId: req.id, description: 'Build and run payment services in TypeScript.' })).body.data;
    await ctx.http().post(`${API}/recruitment/jobs/${job.id}/status`).set(recruiter.h).send({ status: 'OPEN' });
    const candidate = (await ctx.http().post(`${API}/recruitment/candidates`).set(recruiter.h).send({ firstName: 'Meera', lastName: 'Iyer', email: 'meera@example.com', jobId: job.id })).body.data;
    const appId = candidate.applications[0].id as string;
    await ctx.http().post(`${API}/recruitment/applications/${appId}/stage`).set(recruiter.h).send({ stage: 'OFFER' });

    await refusesUnentitled(s.h, 'OFFER', s.ravi.membership.id);
    await grant(s.organization.id, s.ravi, 'recruitment.offer.approve');
    // Department managers can't approve offers by default; the hiring manager step needs them to.
    await grant(s.organization.id, s.manager, 'recruitment.offer.approve');
    await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({
      subject: 'OFFER',
      name: 'Senior offers',
      conditions: { minAmount: 2_000_000 },
      steps: [
        { label: 'Hiring manager', approver: 'MANAGER' },
        { label: 'CFO', approver: 'USER', membershipId: s.ravi.membership.id },
      ],
    });
    const future = addDays(orgToday(), 40);
    const offer = (await ctx.http().post(`${API}/recruitment/applications/${appId}/offers`).set(recruiter.h).send({ annualCtc: 2_500_000, joiningDate: future })).body.data;
    // Within the requisition budget, but the chain makes approval required.
    expect(offer.approval.required).toContain('Senior offers');
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/release`).set(recruiter.h)).status).toBe(409);
    const sent = (await ctx.http().post(`${API}/recruitment/offers/${offer.id}/submit-approval`).set(recruiter.h)).body.data;
    expect(sent.approval.status).toBe('PENDING');

    const awaiting = async (h: Record<string, string>) => ((await ctx.http().get(`${API}/recruitment/offers/awaiting-approval`).set(h)).body.data as { id: string; awaiting: string }[]);
    expect(await awaiting(s.ravi.h)).toEqual([]);
    expect((await awaiting(s.manager.h)).map((o) => o.awaiting)).toEqual(['Hiring manager']);
    // HR holds recruitment.offer.approve but the chain decides.
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/approve`).set(s.hr.h).send({})).body.error.message).toMatch(/waiting for Hiring manager/);
    const decide = (h: Record<string, string>, action: 'approve' | 'reject-approval', note = 'Noted') => ctx.http().post(`${API}/recruitment/offers/${offer.id}/${action}`).set(h).send({ note });
    expect((await decide(s.manager.h, 'approve')).body.data.approval).toMatchObject({ status: 'PENDING', chain: { currentStep: 1 } });
    // A change sends it back to draft; resubmitting starts a fresh round from the first step.
    expect((await ctx.http().patch(`${API}/recruitment/offers/${offer.id}`).set(recruiter.h).send({ annualCtc: 2_400_000 })).body.data.approval.status).toBe('NOT_REQUIRED');
    expect((await ApprovalInstance.findOne({ where: { subjectId: offer.id }, ...RAW }))!.status).toBe('CANCELLED');
    expect((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/submit-approval`).set(recruiter.h)).body.data.approval.chain).toMatchObject({ status: 'PENDING', currentStep: 0 });
    await decide(s.manager.h, 'approve');
    // A rejection at any step ends the round.
    expect((await decide(s.ravi.h, 'reject-approval', 'Too high for the band')).body.data.approval).toMatchObject({ status: 'REJECTED', chain: { status: 'REJECTED' } });

    await ctx.http().post(`${API}/recruitment/offers/${offer.id}/submit-approval`).set(recruiter.h);
    await decide(s.manager.h, 'approve');
    expect((await awaiting(s.ravi.h)).map((o) => o.id)).toEqual([offer.id]);
    // The approvals summary counts it for the named approver.
    const summary = (await ctx.http().get(`${API}/dashboard/approvals`).set(s.ravi.h)).body.data as { key: string; count: number }[];
    expect(summary).toEqual([{ key: 'offers', count: 1 }]);
    expect((await ctx.http().get(`${API}/recruitment/offers/${offer.id}`).set(s.ravi.h)).body.data.approval.canDecide).toBe(true);
    const approved = (await decide(s.ravi.h, 'approve', 'Go ahead')).body.data;
    expect(approved.approval).toMatchObject({ status: 'APPROVED', chain: { status: 'APPROVED' } });
    expect([200, 201]).toContain((await ctx.http().post(`${API}/recruitment/offers/${offer.id}/release`).set(recruiter.h)).status);
    // Someone never on the chain can't open offers.
    expect((await ctx.http().get(`${API}/recruitment/offers/${offer.id}`).set(s.asha.h)).status).toBe(404);
  });
});
