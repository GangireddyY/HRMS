import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays, resetDatabase, uniqueEmail } from './helpers';

describe('Dashboard approvals summary (e2e)', () => {
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

  it('counts what waits for a decision in one request, matching the lists', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const user = await createUser(ctx, { email: uniqueEmail('emp'), lastName: 'Person' });
    const membership = await addMember(ctx, org.organization.id, user.id, ['employee']);
    expect((await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id })).status).toBe(201);
    const eh = bearer((await login(ctx, user.email)).accessToken);
    const type = (await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'CL', name: 'Casual leave', annualQuota: 12, accrualFrequency: 'YEARLY' })).body.data;
    const day = orgDays(20);
    const leave = await ctx.http().post(`${API}/leave/requests`).set(eh).send({ leaveTypeId: type.id, startDate: day, endDate: day, reason: 'Family function' });
    expect(leave.status).toBe(201);

    const summary = (await ctx.http().get(`${API}/dashboard/approvals`).set(h)).body.data as { key: string; count: number; failed?: boolean }[];
    expect(summary.filter((s) => s.failed)).toEqual([]);
    const by = new Map(summary.map((s) => [s.key, s.count]));
    expect(by.get('leave')).toBe(1);

    // Same numbers as the list endpoints the dashboard used to call one by one.
    const lists: Record<string, string> = {
      leave: '/leave/requests?view=team&status=PENDING',
      'comp-off': '/leave/comp-offs?view=team&status=PENDING',
      encashments: '/leave/encashments?view=all&status=PENDING',
      regularizations: '/attendance/regularizations?view=team&status=PENDING',
      wfh: '/attendance/work-from-home?view=team&status=PENDING',
      overtime: '/attendance/overtime?view=team&status=PENDING',
      timesheets: '/attendance/timesheets?view=team&status=SUBMITTED',
      claims: '/payroll/reimbursements?view=approve&status=PENDING',
      loans: '/payroll/loans?view=approve',
      payroll: '/payroll/runs?status=SUBMITTED',
      requisitions: '/recruitment/requisitions?view=approve',
      exits: '/exits?view=approve',
      travel: '/travel/requests?view=team&status=PENDING',
      'asset-requests': '/assets/requests?view=all&status=PENDING',
      probation: '/onboarding/probation/reviews?view=approve',
    };
    for (const [key, path] of Object.entries(lists)) {
      if (!by.has(key)) continue;
      const res = await ctx.http().get(`${API}${path}&page=1&pageSize=1`).set(h);
      expect({ key, status: res.status, total: res.body.meta?.total }).toEqual({ key, status: 200, total: by.get(key) });
    }

    // Someone who decides nothing gets an empty summary.
    expect((await ctx.http().get(`${API}/dashboard/approvals`).set(eh)).body.data).toEqual([]);
  });
});
