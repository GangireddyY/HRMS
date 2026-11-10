import { LeaveEncashment, LeaveLedgerEntry, Notification } from '../src/database/models';
import { LeaveAccrualJob } from '../src/modules/leave/leave-accrual.job';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

type Balance = { leaveType: { code: string }; balance: number | null; available: number | null };
type Line = { code: string; name: string; amount: number; rate?: number };

describe('Leave rules, encashment and the accrual job (e2e)', () => {
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
    async function person(roleKeys: string[], extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const type = async (body: Record<string, unknown>) => {
      const res = await ctx.http().post(`${API}/leave/types`).set(h).send(body);
      expect(res.status).toBe(201);
      return res.body.data as { id: string; code: string };
    };
    return { ...org, h, person, type };
  }
  const balances = async (who: { h: Record<string, string> }) => (await ctx.http().get(`${API}/leave/balances`).set(who.h)).body.data.balances as Balance[];
  const of = (rows: Balance[], code: string) => rows.find((b) => b.leaveType.code === code);

  it('applies types by employment type and caps accrual at the maximum balance', async () => {
    const { person, type } = await setup();
    const contractLeave = await type({ code: 'CT', name: 'Contractor leave', annualQuota: 12, accrualFrequency: 'MONTHLY', employmentTypes: ['CONTRACT'] });
    expect(contractLeave).toMatchObject({ employmentTypes: ['CONTRACT'], locationIds: null });
    const el = await type({ code: 'EL', name: 'Earned leave', annualQuota: 24, accrualFrequency: 'MONTHLY', maxBalance: 5 });
    const staff = await person(['employee']);
    const contractor = await person(['employee'], { employmentType: 'CONTRACT' });

    const staffBalances = await balances(staff);
    expect(of(staffBalances, 'CT')).toBeUndefined();
    expect(of(staffBalances, 'EL')).toMatchObject({ balance: 5 });
    expect(of(await balances(contractor), 'CT')).toBeDefined();

    const ledger = (await ctx.http().get(`${API}/leave/ledger?leaveTypeId=${el.id}`).set(staff.h)).body.data as { kind: string; days: number; note: string }[];
    expect(ledger.map((l) => l.days)).toEqual([2, 2, 1]);
    expect(ledger[2]!.note).toContain('capped at the 5-day limit');

    const apply = await ctx.http().post(`${API}/leave/requests`).set(staff.h).send({ leaveTypeId: contractLeave.id, startDate: '2026-12-01', endDate: '2026-12-01', reason: 'Personal work' });
    expect(apply.status).toBe(422);
    expect(JSON.stringify(apply.body)).toContain('does not apply to you');
  });

  it('pays approved leave encashment with the next payroll run', async () => {
    const { h, person, type } = await setup();
    const hr = await person(['hr_manager']);
    const pm = await person(['payroll_manager']);
    const finance = await person(['finance_manager']);
    const emp = await person(['employee']);
    const el = await type({ code: 'EL', name: 'Earned leave', annualQuota: 15, accrualFrequency: 'YEARLY', encashable: true, encashMaxDays: 5, encashMinBalance: 2 });

    const options = (await ctx.http().get(`${API}/leave/encashments/options`).set(emp.h)).body.data;
    expect(options.types).toEqual([expect.objectContaining({ leaveType: expect.objectContaining({ code: 'EL' }), available: 15, max: 5, keep: 2, yearlyLimit: 5 })]);
    const ask = (days: number) => ctx.http().post(`${API}/leave/encashments`).set(emp.h).send({ leaveTypeId: el.id, days, reason: 'School fees' });
    expect((await ask(6)).status).toBe(422);
    const asked = await ask(4);
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({ status: 'PENDING', days: 4, permissions: { cancel: true, review: false } });
    expect((await ask(1)).status).toBe(409);
    expect(await Notification.count({ where: { userId: hr.user.id, type: 'leave.encashment' }, ...RAW })).toBe(1);

    const id = asked.body.data.id;
    expect((await ctx.http().post(`${API}/leave/encashments/${id}/approve`).set(emp.h).send({})).status).toBe(403);
    const approved = await ctx.http().post(`${API}/leave/encashments/${id}/approve`).set(hr.h).send({});
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    expect(of(await balances(emp), 'EL')).toMatchObject({ balance: 11 });
    expect(await LeaveLedgerEntry.count({ where: { idempotencyKey: `encash:${id}` }, ...RAW })).toBe(1);
    // The yearly limit counts what was approved.
    expect((await ctx.http().get(`${API}/leave/encashments/options`).set(emp.h)).body.data.types[0]).toMatchObject({ max: 1, usedThisYear: 4 });

    const rec = await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({});
    const structure = rec.body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    expect((await ctx.http().post(`${API}/payroll/employees/${emp.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 600000, effectiveFrom: '2026-04-01' })).status).toBe(201);
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(pm.h).send({ year: 2026, month: 10 })).body.data;
    const slipId = ((await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(pm.h)).body.data as { id: string; employeeId: string }[]).find((p) => p.employeeId === emp.employee.id)!.id;
    const slip = (await ctx.http().get(`${API}/payroll/payslips/${slipId}`).set(pm.h)).body.data;
    const basic = (slip.earnings as Line[]).find((l) => l.code === 'BASIC')!;
    const encash = (slip.earnings as Line[]).find((l) => l.code.startsWith('ENCASH_'))!;
    expect(encash).toMatchObject({ name: 'Earned leave encashment (4 days)', amount: Math.round((4 * basic.rate!) / 26) });
    expect((await LeaveEncashment.findByPk(id, RAW))!.payrollRunId).toBe(run.id);

    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(pm.h).send({})).status).toBe(201);
    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(finance.h).send({})).status).toBe(201);
    const paid = (await ctx.http().get(`${API}/leave/encashments`).set(emp.h)).body.data[0];
    expect(paid).toMatchObject({ status: 'PAID', amount: encash.amount, payrollRunId: run.id });
    expect(paid.paidAt).not.toBeNull();
  });

  it('brings leave up to date once a night from the nightly job', async () => {
    const { type, person } = await setup();
    await type({ code: 'CL', name: 'Casual leave', annualQuota: 12, accrualFrequency: 'MONTHLY' });
    const emp = await person(['employee']);
    expect(await LeaveLedgerEntry.count({ where: { employeeId: emp.employee.id }, ...RAW })).toBe(0);
    const job = ctx.app.get(LeaveAccrualJob);
    const midday = new Date();
    midday.setUTCHours(8, 0, 0, 0);
    expect(await job.tick(midday)).toBe(1);
    expect(await LeaveLedgerEntry.count({ where: { employeeId: emp.employee.id, kind: 'ACCRUAL' }, ...RAW })).toBeGreaterThan(0);
    expect(await job.tick(midday)).toBe(0);
  });
});
