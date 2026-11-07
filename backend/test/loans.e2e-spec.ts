import { EmployeeLoan, EmployeeLoanRepayment, Notification } from '../src/database/models';
import { loanEmi } from '../src/modules/payroll/loan-rules';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday as today, resetDatabase, uniqueEmail } from './helpers';

type Line = { code: string; name: string; amount: number };
type Slip = { employee: { name: string }; deductions: Line[] };
const thisMonth = () => ({ year: Number(today().slice(0, 4)), month: Number(today().slice(5, 7)) });

describe('Loans & salary advances (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], firstName: string, extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function payslips(runId: string, h: Record<string, string>): Promise<Slip[]> {
    const rows = (await ctx.http().get(`${API}/payroll/runs/${runId}/payslips`).set(h)).body.data as { id: string }[];
    return Promise.all(rows.map(async (r) => (await ctx.http().get(`${API}/payroll/payslips/${r.id}`).set(h)).body.data as Slip));
  }

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const pm = await person(org.organization.id, h, ['payroll_manager'], 'Priya');
    const fin = await person(org.organization.id, h, ['finance_manager'], 'Farah');
    const asha = await person(org.organization.id, h, ['employee'], 'Asha');
    const ravi = await person(org.organization.id, h, ['employee'], 'Ravi');
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    for (const p of [asha, ravi]) {
      expect((await ctx.http().post(`${API}/payroll/employees/${p.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' })).status).toBe(201);
    }
    return { org, h, pm, fin, asha, ravi };
  }

  it('takes a loan from request through approval, disbursal and payroll deductions to closure', async () => {
    const s = await setup();
    const now = thisMonth();

    // Requests: one pending at a time; advances are short and interest-free.
    expect((await ctx.http().post(`${API}/payroll/me/loans`).set(s.asha.h).send({ type: 'ADVANCE', amount: 20000, tenureMonths: 13, purpose: 'Medical' })).status).toBe(422);
    const requested = await ctx.http().post(`${API}/payroll/me/loans`).set(s.asha.h).send({ type: 'LOAN', amount: 80000, tenureMonths: 12, purpose: 'Home repairs' });
    expect(requested.status).toBe(201);
    const id = requested.body.data.id;
    expect(requested.body.data).toMatchObject({ reference: 'LOAN-0001', status: 'REQUESTED', principal: 80000, emi: null, permissions: { cancel: true, approve: false } });
    expect((await ctx.http().post(`${API}/payroll/me/loans`).set(s.asha.h).send({ type: 'ADVANCE', amount: 5000, tenureMonths: 2, purpose: 'Rent' })).status).toBe(409);
    expect(await Notification.count({ where: { userId: [s.fin.user.id, s.org.admin.id], type: 'payroll.loan' }, ...RAW })).toBe(2);

    // Only approvers decide, never on their own loans; terms are checked.
    expect((await ctx.http().get(`${API}/payroll/loans`).set(s.asha.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/payroll/loans/${id}`).set(s.ravi.h)).status).toBe(404);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.pm.h).send({ startYear: now.year, startMonth: now.month })).status).toBe(403);
    expect((await ctx.http().get(`${API}/payroll/loans?view=approve`).set(s.fin.h)).body.data.map((l: { id: string }) => l.id)).toEqual([id]);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.fin.h).send({ amount: 90000, interestRate: 12, startYear: now.year, startMonth: now.month })).status).toBe(422);
    const lastMonth = now.month === 1 ? { year: now.year - 1, month: 12 } : { year: now.year, month: now.month - 1 };
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.fin.h).send({ interestRate: 12, startYear: lastMonth.year, startMonth: lastMonth.month })).status).toBe(422);
    const approved = await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.fin.h).send({ amount: 60000, tenureMonths: 6, interestRate: 12, startYear: now.year, startMonth: now.month, note: 'Approved for 6 months' });
    const emi = loanEmi(60000, 12, 6);
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', principal: 60000, tenureMonths: 6, interestRate: 12, emi, decidedBy: 'Farah Person' });
    expect(approved.body.data.schedule).toHaveLength(6);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/cancel`).set(s.asha.h).send({})).status).toBe(403);

    // Disbursed by payroll, then deducted by the payroll run: interest on the balance plus principal.
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/disburse`).set(s.asha.h).send({ disbursedOn: today(), reference: 'NEFT1' })).status).toBe(403);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/disburse`).set(s.pm.h).send({ disbursedOn: '2099-01-01', reference: 'NEFT1' })).status).toBe(422);
    const disbursed = await ctx.http().post(`${API}/payroll/loans/${id}/disburse`).set(s.pm.h).send({ disbursedOn: today(), reference: 'NEFT20261106' });
    expect(disbursed.body.data).toMatchObject({ status: 'ACTIVE', outstanding: 60000, nextInstalment: { interest: 600, principal: emi - 600, amount: emi } });

    const run = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: now.year, month: now.month })).body.data;
    const slips = await payslips(run.id, s.pm.h);
    const ashaSlip = slips.find((p) => p.employee.name === 'Asha Person')!;
    expect(ashaSlip.deductions.find((l) => l.code.startsWith('LOAN_'))).toMatchObject({ name: 'Loan repayment (LOAN-0001)', amount: emi });
    expect(slips.find((p) => p.employee.name === 'Ravi Person')!.deductions.some((l) => l.code.startsWith('LOAN_'))).toBe(false);
    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(s.pm.h).send({});
    // Nothing is changed by hand while the run waits for approval.
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/repayments`).set(s.pm.h).send({ amount: 1000, paidOn: today(), note: 'Cash' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(s.fin.h).send({})).status).toBe(201);
    const afterRun = (await ctx.http().get(`${API}/payroll/loans/${id}`).set(s.asha.h)).body.data;
    expect(afterRun).toMatchObject({ status: 'ACTIVE', repaid: emi - 600, interestPaid: 600, outstanding: 60000 - (emi - 600), instalmentsPaid: 1 });
    expect(afterRun.repayments).toEqual([expect.objectContaining({ source: 'PAYROLL', principal: emi - 600, interest: 600 })]);
    expect(afterRun.schedule[0]).toMatchObject({ year: now.month === 12 ? now.year + 1 : now.year, month: now.month === 12 ? 1 : now.month + 1 });

    // A direct repayment of the rest closes it.
    const owed = afterRun.outstanding as number;
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/repayments`).set(s.pm.h).send({ amount: owed + 1, paidOn: today(), note: 'Bank transfer' })).status).toBe(422);
    const closed = await ctx.http().post(`${API}/payroll/loans/${id}/repayments`).set(s.pm.h).send({ amount: owed, paidOn: today(), note: 'Bank transfer' });
    expect(closed.body.data).toMatchObject({ status: 'CLOSED', outstanding: 0, nextInstalment: null, schedule: [] });
    expect((await ctx.http().get(`${API}/payroll/me/loans`).set(s.asha.h)).body.data).toMatchObject({ canRequest: true, loans: [expect.objectContaining({ id, status: 'CLOSED' })] });

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/payroll/loans/${id}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/payroll/loans`).set(oh)).body.data).toEqual([]);
  });

  it('lets payroll raise an advance that someone else approves, defers it and recovers the balance at exit', async () => {
    const s = await setup();
    const now = thisMonth();
    const next = now.month === 12 ? { year: now.year + 1, month: 1 } : { year: now.year, month: now.month + 1 };
    expect((await ctx.http().post(`${API}/payroll/loans`).set(s.fin.h).send({ employeeId: s.fin.employee.id, type: 'ADVANCE', amount: 20000, tenureMonths: 4, purpose: 'Own' })).status).toBe(403);
    const raised = await ctx.http().post(`${API}/payroll/loans`).set(s.fin.h).send({ employeeId: s.ravi.employee.id, type: 'ADVANCE', amount: 20000, tenureMonths: 4, purpose: 'Relocation' });
    expect(raised.body.data).toMatchObject({ reference: 'ADV-0001', type: 'ADVANCE', status: 'REQUESTED' });
    const id = raised.body.data.id;
    // Whoever raised it can't approve it; advances can't carry interest.
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.fin.h).send({ startYear: now.year, startMonth: now.month })).status).toBe(403);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.h).send({ interestRate: 5, startYear: now.year, startMonth: now.month })).status).toBe(422);
    expect((await ctx.http().post(`${API}/payroll/loans/${id}/approve`).set(s.h).send({ startYear: now.year, startMonth: now.month })).body.data).toMatchObject({ status: 'APPROVED', emi: 5000 });
    await ctx.http().post(`${API}/payroll/loans/${id}/disburse`).set(s.fin.h).send({ disbursedOn: today(), reference: 'IMPS1' });
    const deferred = await ctx.http().post(`${API}/payroll/loans/${id}/defer`).set(s.pm.h).send({ startYear: next.year, startMonth: next.month, note: 'Starts after the relocation month' });
    expect(deferred.body.data.start).toMatchObject(next);
    // Deferred: this month's payroll doesn't deduct it.
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: now.year, month: now.month })).body.data;
    const slips = await payslips(run.id, s.pm.h);
    expect(slips.some((p) => p.deductions.some((l) => l.code.startsWith('LOAN_')))).toBe(false);
    await ctx.http().post(`${API}/payroll/runs/${run.id}/cancel`).set(s.pm.h).send({});

    // Ravi leaves: the advance still owed is recovered in the full & final settlement.
    const exit = (await ctx.http().post(`${API}/exits/resign`).set(s.ravi.h).send({ reason: 'RELOCATION' })).body.data;
    await ctx.http().post(`${API}/exits/${exit.id}/approve`).set(s.h).send({ lastWorkingDay: today() });
    const settlement = (await ctx.http().post(`${API}/exits/${exit.id}/settlement`).set(s.pm.h).send({})).body.data;
    expect(settlement.lines.find((l: { code: string }) => l.code === 'LOAN_ADV-0001')).toMatchObject({ kind: 'DEDUCTION', amount: 20000, label: 'Salary advance recovery – ADV-0001' });
    await ctx.http().post(`${API}/exits/${exit.id}/settlement/submit`).set(s.pm.h).send({});
    expect((await ctx.http().post(`${API}/exits/${exit.id}/settlement/approve`).set(s.fin.h).send({})).status).toBe(201);
    expect(await EmployeeLoan.findByPk(id, RAW)).toMatchObject({ status: 'CLOSED' });
    expect(await EmployeeLoanRepayment.findAll({ where: { loanId: id }, ...RAW })).toEqual([expect.objectContaining({ source: 'SETTLEMENT', principal: '20000.00' })]);
  });
});
