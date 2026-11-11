import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

type Line = { code: string; name: string; amount: number };

describe('Legal entities, currencies and exchange rates (e2e)', () => {
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
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const pm = await person(['payroll_manager']);
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    const salary = (employeeId: string, annualCtc: number) => ctx.http().post(`${API}/payroll/employees/${employeeId}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc, effectiveFrom: '2026-04-01', reason: 'Joining' });
    return { ...org, h, person, pm, salary };
  }

  it('keeps entities with their own currency; payroll outside India skips Indian statutory deductions', async () => {
    const s = await setup();
    const india = (await ctx.http().post(`${API}/legal-entities`).set(s.h).send({ name: 'Acme India', legalName: 'Acme Software India Private Limited', country: 'in', currency: 'inr', registrations: [{ label: 'PAN', value: 'AAACA1234A' }] })).body.data;
    // The first entity becomes the default.
    expect(india).toMatchObject({ country: 'IN', currency: 'INR', isDefault: true, statutory: true });
    const us = (await ctx.http().post(`${API}/legal-entities`).set(s.h).send({ name: 'Acme US', legalName: 'Acme Software Inc.', country: 'US', currency: 'USD', registrations: [{ label: 'EIN', value: '12-3456789' }], city: 'Austin', state: 'TX' })).body.data;
    expect(us).toMatchObject({ isDefault: false, statutory: false, address: { city: 'Austin' } });
    expect((await ctx.http().post(`${API}/legal-entities`).set(s.h).send({ name: 'acme us', legalName: 'Dup', country: 'US', currency: 'USD' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/legal-entities`).set(s.h).send({ name: 'Bad', legalName: 'Bad', country: 'USA', currency: 'US' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/legal-entities`).set(s.pm.h).send({ name: 'No rights', legalName: 'x', country: 'IN', currency: 'INR' })).status).toBe(403);
    expect((await ctx.http().delete(`${API}/legal-entities/${india.id}`).set(s.h)).status).toBe(409);

    // A US pay group; Dana works for the US entity.
    const dana = await s.person(['employee']);
    const ravi = await s.person(['employee']);
    for (const e of [dana, ravi]) await s.salary(e.employee.id, 1_200_000);
    const group = (await ctx.http().post(`${API}/payroll/pay-groups`).set(s.h).send({ name: 'US payroll', legalEntityId: us.id })).body.data;
    expect(group.legalEntity).toMatchObject({ name: 'Acme US', currency: 'USD' });
    await ctx.http().put(`${API}/payroll/pay-groups/members`).set(s.h).send({ employeeIds: [dana.employee.id], payGroupId: group.id });
    const assigned = (await ctx.http().post(`${API}/legal-entities/assign`).set(s.h).send({ legalEntityId: us.id, employeeIds: [dana.employee.id] })).body.data;
    expect(assigned.find((e: { id: string }) => e.id === us.id)).toMatchObject({ employees: 1, payGroups: 1 });
    expect((await ctx.http().delete(`${API}/legal-entities/${us.id}`).set(s.h)).status).toBe(409);

    const slipOf = async (payGroupId?: string) => {
      const run = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10, payGroupId })).body.data;
      const slips = (await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(s.pm.h)).body.data as { id: string }[];
      return (await ctx.http().get(`${API}/payroll/payslips/${slips[0]!.id}`).set(s.pm.h)).body.data as { currency: string | null; deductions: Line[]; employerContributions: Line[] };
    };
    const usSlip = await slipOf(group.id);
    expect(usSlip.currency).toBe('USD');
    expect(usSlip.deductions.filter((d) => ['EPF', 'PF', 'ESI', 'PT', 'TDS', 'LWF'].includes(d.code) && d.amount > 0)).toEqual([]);
    const inSlip = await slipOf();
    expect(inSlip.currency).toBe('INR');
    expect(inSlip.deductions.some((d) => d.amount > 0)).toBe(true);
  });

  it('converts expense receipts in other currencies at the rate on the expense date', async () => {
    const s = await setup();
    await ctx.http().post(`${API}/legal-entities`).set(s.h).send({ name: 'Acme India', legalName: 'Acme India Pvt Ltd', country: 'IN', currency: 'INR' });
    const asha = await s.person(['employee']);
    const claim = (body: Record<string, string>) => {
      const r = ctx.http().post(`${API}/payroll/reimbursements`).set(asha.h);
      for (const [k, v] of Object.entries({ category: 'TRAVEL', title: 'Conference taxi', expenseDate: '2026-11-04', ...body })) r.field(k, v);
      return r;
    };

    // No rate yet: a clear error.
    const missing = await claim({ amount: '50', currency: 'USD' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details[0]).toMatchObject({ field: 'currency' });

    // Rates: payroll sets them; the base currency is always 1; a later rate doesn't apply to earlier expenses.
    expect((await ctx.http().put(`${API}/exchange-rates`).set(asha.h).send({ currency: 'USD', rate: 83, effectiveOn: '2026-11-01' })).status).toBe(403);
    expect((await ctx.http().put(`${API}/exchange-rates`).set(s.pm.h).send({ currency: 'INR', rate: 1, effectiveOn: '2026-11-01' })).status).toBe(422);
    await ctx.http().put(`${API}/exchange-rates`).set(s.pm.h).send({ currency: 'USD', rate: 83.25, effectiveOn: '2026-11-01', source: 'RBI reference rate' });
    const rates = (await ctx.http().put(`${API}/exchange-rates`).set(s.pm.h).send({ currency: 'USD', rate: 84, effectiveOn: '2026-11-10' })).body.data;
    expect(rates.base).toBe('INR');
    expect(rates.latest).toEqual([expect.objectContaining({ currency: 'USD', rate: 84, effectiveOn: '2026-11-10' })]);

    const created = await claim({ amount: '50', currency: 'usd' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ amount: 4162.5, original: { currency: 'USD', amount: 50, rate: 83.25 } });
    // In the pay currency: no conversion.
    expect((await claim({ amount: '1200', currency: 'INR', title: 'Local cab' })).body.data).toMatchObject({ amount: 1200, original: null });
  });
});
