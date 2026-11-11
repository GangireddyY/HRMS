import { ApprovalInstance, LeaveLedgerEntry, Notification } from '../src/database/models';
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

  it('routes leave through a configured chain: steps in order, outside-scope approvers, rejection', async () => {
    const s = await setup();
    // Configuring chains needs approvals.configure; steps are validated.
    expect((await ctx.http().get(`${API}/approvals/chains`).set(s.asha.h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/approvals/chains`).set(s.h).send({ subject: 'LEAVE', name: 'Bad', steps: [{ label: 'HR', approver: 'PERMISSION' }] })).status).toBe(422);
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

    // The named person decides the last step even without any leave permission.
    expect((await team(s.ravi.h)).map((r) => r.id)).toEqual([long.id]);
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
    // The named budget owner (an employee without claim permissions) can open and approve it.
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${big.id}`).set(s.ravi.h)).status).toBe(200);
    const done = (await pay(s.ravi.h)).body.data;
    expect(done.status).toBe('APPROVED');
    expect(done.chain.decisions).toHaveLength(3);
    // Once settled, the named approver has no claim rights left.
    expect((await pay(s.ravi.h)).status).toBe(403);
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
});
