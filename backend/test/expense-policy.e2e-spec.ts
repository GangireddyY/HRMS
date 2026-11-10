import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

describe('Expense policies and finance approval (e2e)', () => {
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

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const pm = await person(org.organization.id, h, ['payroll_manager']);
    const finance = await person(org.organization.id, h, ['finance_manager']);
    const finance2 = await person(org.organization.id, h, ['finance_manager']);
    const manager = await person(org.organization.id, h, ['department_manager'], { departmentId: eng.id });
    const ravi = await person(org.organization.id, h, ['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    return { org, h, pm, finance, finance2, manager, ravi };
  }

  const claim = (h: Record<string, string>, category: string, amount: number, expenseDate = '2026-10-05', receipt = false) => {
    const req = ctx.http().post(`${API}/payroll/reimbursements`).set(h).field('category', category).field('title', `${category} ${amount}`).field('expenseDate', expenseDate).field('amount', String(amount));
    return receipt ? req.attach('file', PDF, 'receipt.pdf') : req;
  };
  const titles = async (h: Record<string, string>) => ((await ctx.http().get(`${API}/notifications`).set(h)).body.data as { title: string }[]).map((n) => n.title);

  it('enforces per-category limits, monthly limits and receipts', async () => {
    const s = await setup();
    const policy = `${API}/payroll/expense-policy`;
    const initial = (await ctx.http().get(policy).set(s.ravi.h)).body.data;
    expect(initial.categories).toHaveLength(7);
    expect(initial).toMatchObject({ financeApprovalAbove: null, categories: expect.arrayContaining([{ category: 'TRAVEL', allowed: true, perClaimLimit: null, monthlyLimit: null, receiptRequiredAbove: null }]) });

    const rules = [
      { category: 'TRAVEL', perClaimLimit: 5000, monthlyLimit: 8000, receiptRequiredAbove: 1000 },
      { category: 'FOOD', receiptRequiredAbove: 0 },
      { category: 'OTHER', allowed: false },
    ];
    expect((await ctx.http().put(policy).set(s.ravi.h).send({ categories: rules })).status).toBe(403);
    expect((await ctx.http().put(policy).set(s.pm.h).send({ categories: [{ category: 'TRAVEL', perClaimLimit: 9000, monthlyLimit: 8000 }] })).status).toBe(422);
    const saved = await ctx.http().put(policy).set(s.pm.h).send({ categories: rules, financeApprovalAbove: 3000 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.categories.find((c: { category: string }) => c.category === 'TRAVEL')).toMatchObject({ perClaimLimit: 5000, monthlyLimit: 8000, receiptRequiredAbove: 1000 });
    expect(saved.body.data.financeApprovalAbove).toBe(3000);

    const err = async (res: Promise<{ status: number; body: { error?: { details?: { field: string; message: string }[] } } }>) => {
      const r = await res;
      expect(r.status).toBe(422);
      return r.body.error!.details![0]!;
    };
    expect((await err(claim(s.ravi.h, 'OTHER', 100))).message).toMatch(/can't be claimed/);
    expect((await err(claim(s.ravi.h, 'TRAVEL', 6000, '2026-10-05', true))).message).toMatch(/5,000 per claim/);
    expect(await err(claim(s.ravi.h, 'TRAVEL', 1500))).toMatchObject({ field: 'file', message: expect.stringMatching(/above ₹1,000/) });
    expect((await err(claim(s.ravi.h, 'FOOD', 200))).message).toBe('Attach a receipt for food claims');

    const small = await claim(s.ravi.h, 'TRAVEL', 900);
    expect(small.status).toBe(201);
    expect((await claim(s.ravi.h, 'TRAVEL', 4000, '2026-10-10', true)).status).toBe(201);
    expect((await err(claim(s.ravi.h, 'TRAVEL', 4000, '2026-10-20', true))).message).toMatch(/₹8,000 a month; ₹3,100 is left for October 2026/);
    expect((await claim(s.ravi.h, 'TRAVEL', 3000, '2026-10-21', true)).status).toBe(201);
    expect((await claim(s.ravi.h, 'TRAVEL', 4000, '2026-11-02', true)).status).toBe(201);

    let usage = (await ctx.http().get(`${API}/payroll/me/reimbursements/usage?month=2026-10`).set(s.ravi.h)).body.data;
    expect(usage.used).toMatchObject({ TRAVEL: 7900, FOOD: 0 });
    await ctx.http().post(`${API}/payroll/reimbursements/${small.body.data.id}/cancel`).set(s.ravi.h).send({});
    usage = (await ctx.http().get(`${API}/payroll/me/reimbursements/usage?month=2026-10`).set(s.ravi.h)).body.data;
    expect(usage.used.TRAVEL).toBe(7000);
    expect((await ctx.http().get(`${API}/payroll/me/reimbursements/usage?month=2026-13`).set(s.ravi.h)).status).toBe(422);

    // The approver sees the month's total against the limit.
    const queue = (await ctx.http().get(`${API}/payroll/reimbursements?view=approve`).set(s.manager.h)).body.data as { id: string; expenseDate: string }[];
    const october = queue.find((q) => q.expenseDate === '2026-10-21')!;
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${october.id}`).set(s.manager.h)).body.data.policy).toEqual({ perClaimLimit: 5000, monthlyLimit: 8000, monthUsed: 7000, month: '2026-10' });
  });

  it('sends large claims to finance after the manager, with an approval trail', async () => {
    const s = await setup();
    await ctx.http().put(`${API}/payroll/expense-policy`).set(s.pm.h).send({ categories: [], financeApprovalAbove: 3000 });
    const big = (await claim(s.ravi.h, 'TRAVEL', 4000, '2026-10-05', true)).body.data;
    const url = `${API}/payroll/reimbursements/${big.id}`;

    // Manager approves: finance is next.
    let c = (await ctx.http().post(`${url}/approve`).set(s.manager.h).send({ note: 'Client visit' })).body.data;
    expect(c).toMatchObject({ status: 'PENDING', approvalStage: 'FINANCE', trail: [{ step: 'MANAGER', decision: 'APPROVED', note: 'Client visit' }] });
    expect(await titles(s.ravi.h)).toContain(`Your claim "${big.title}" was approved by your manager`);
    expect((await titles(s.finance.h)).some((t) => t.startsWith('Finance approval needed'))).toBe(true);
    expect((await ctx.http().get(`${API}/payroll/reimbursements?view=approve`).set(s.manager.h)).body.data).toHaveLength(0);
    expect((await ctx.http().get(`${API}/payroll/reimbursements?view=finance`).set(s.finance.h)).body.data).toEqual([expect.objectContaining({ id: big.id, permissions: expect.objectContaining({ review: true }) })]);
    expect((await ctx.http().get(`${API}/payroll/reimbursements?view=finance`).set(s.manager.h)).body.data).toHaveLength(0);
    expect((await ctx.http().post(`${url}/approve`).set(s.manager.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${url}/approve`).set(s.ravi.h).send({})).status).toBe(403);

    // Finance approves: paid with the next run.
    c = (await ctx.http().post(`${url}/approve`).set(s.finance.h).send({})).body.data;
    expect(c).toMatchObject({ status: 'APPROVED', approvalStage: null, trail: [{ step: 'MANAGER' }, { step: 'FINANCE', decision: 'APPROVED' }] });
    expect(await titles(s.ravi.h)).toContain(`Your claim "${big.title}" was approved`);

    // Whoever gave the first approval can't give the finance one too.
    const second = (await claim(s.ravi.h, 'TRAVEL', 3500, '2026-10-06', true)).body.data;
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${second.id}/approve`).set(s.finance.h).send({})).body.data.approvalStage).toBe('FINANCE');
    const blocked = await ctx.http().post(`${API}/payroll/reimbursements/${second.id}/approve`).set(s.finance.h).send({});
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/other than the first approver/);
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${second.id}`).set(s.finance.h)).body.data.permissions.review).toBe(false);
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${second.id}/approve`).set(s.finance2.h).send({})).body.data.status).toBe('APPROVED');

    // Finance can reject; small claims need one approval.
    const third = (await claim(s.ravi.h, 'TRAVEL', 3200, '2026-10-07', true)).body.data;
    await ctx.http().post(`${API}/payroll/reimbursements/${third.id}/approve`).set(s.manager.h).send({});
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${third.id}/reject`).set(s.finance.h).send({})).status).toBe(422);
    c = (await ctx.http().post(`${API}/payroll/reimbursements/${third.id}/reject`).set(s.finance.h).send({ note: 'Over the travel policy for this client' })).body.data;
    expect(c).toMatchObject({ status: 'REJECTED', trail: [{ step: 'MANAGER', decision: 'APPROVED' }, { step: 'FINANCE', decision: 'REJECTED', note: 'Over the travel policy for this client' }] });
    const small = (await claim(s.ravi.h, 'TRAVEL', 2500, '2026-10-08', true)).body.data;
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${small.id}/approve`).set(s.manager.h).send({})).body.data).toMatchObject({ status: 'APPROVED', trail: [{ step: 'MANAGER' }] });
  });
});
