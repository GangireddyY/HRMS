import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, totp, uniqueEmail } from './helpers';

type Line = { code: string; amount: number };
const line = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount;

describe('Statutory rates as data (e2e)', () => {
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

  it('applies PF / ESI changes from their effective month and a new year of tax rules, kept by platform admins', async () => {
    // Platform staff must have two-factor authentication enrolled.
    const root = await createUser(ctx, { email: uniqueEmail('root'), platformRole: 'SUPER_ADMIN' });
    const rh = bearer((await login(ctx, root.email)).accessToken);
    const setup = await ctx.http().post(`${API}/auth/mfa/setup`).set(rh);
    expect((await ctx.http().post(`${API}/auth/mfa/enable`).set(rh).send({ code: totp(setup.body.data.secret) })).status).toBe(200);
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const person = async (roles: string[]) => {
      const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roles);
      const employee = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id })).body.data;
      return { employee, h: bearer((await login(ctx, user.email)).accessToken) };
    };
    const pm = await person(['payroll_manager']);
    const asha = await person(['employee']);
    await ctx.http().put(`${API}/employees/${asha.employee.id}/sensitive`).set(h).send({ pan: 'ABCDE1234F' });
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    expect((await ctx.http().post(`${API}/payroll/employees/${asha.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 4_000_000, effectiveFrom: '2026-04-01' })).status).toBe(201);

    // Only platform administrators keep the rates; organizations see what applies to a month.
    const base = `${API}/platform/statutory-rates`;
    expect((await ctx.http().get(base).set(h)).status).toBe(403);
    expect((await ctx.http().put(`${base}/contribution`).set(pm.h).send({})).status).toBe(403);
    const overview = (await ctx.http().get(base).set(rh)).body.data;
    expect(overview.contribution.inForce).toMatchObject({ pfWageCeiling: 15_000, esiWageLimit: 21_000, effectiveFrom: null });
    expect(overview.tax.find((t: { financialYear: number }) => t.financialYear === 2026)).toMatchObject({ source: 'BUILT_IN', confirmed: true, label: 'FY 2026-27' });

    const slip = async (year: number, month: number) => {
      const run = (await ctx.http().post(`${API}/payroll/runs`).set(pm.h).send({ year, month })).body.data;
      const id = ((await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(pm.h)).body.data as { id: string }[])[0]!.id;
      return { run, get: async () => (await ctx.http().get(`${API}/payroll/payslips/${id}`).set(pm.h)).body.data as { deductions: Line[] } };
    };
    const june = await slip(2026, 6);
    expect(line((await june.get()).deductions, 'PF')).toBe(1_800);

    // The PF wage ceiling goes up from 1 July: July uses it, June doesn't (even when recalculated).
    const bad = await ctx.http().put(`${base}/contribution`).set(rh).send({ effectiveFrom: '2026-07-01', pfRate: 0.12, epsRate: 0.2, pfWageCeiling: 21_000, esiEmployeeRate: 0.0075, esiEmployerRate: 0.0325, esiWageLimit: 21_000 });
    expect(bad.status).toBe(422);
    expect((await ctx.http().put(`${base}/contribution`).set(rh).send({ effectiveFrom: '2026-07-01', pfRate: 1.2, epsRate: 0.0833, pfWageCeiling: 21_000, esiEmployeeRate: 0.0075, esiEmployerRate: 0.0325, esiWageLimit: 21_000 })).status).toBe(422);
    const saved = (
      await ctx.http().put(`${base}/contribution`).set(rh).send({ effectiveFrom: '2026-07-01', pfRate: 0.12, epsRate: 0.0833, pfWageCeiling: 21_000, esiEmployeeRate: 0.0075, esiEmployerRate: 0.0325, esiWageLimit: 21_000, source: 'Test notification' })
    ).body.data;
    expect(saved.contribution.entries).toEqual([expect.objectContaining({ effectiveFrom: '2026-07-01', pfWageCeiling: 21_000, source: 'Test notification' })]);
    await ctx.http().post(`${API}/payroll/runs/${june.run.id}/calculate`).set(pm.h).send({});
    expect(line((await june.get()).deductions, 'PF')).toBe(1_800);
    // One run is open at a time.
    await ctx.http().post(`${API}/payroll/runs/${june.run.id}/cancel`).set(pm.h).send({});
    const july = await slip(2026, 7);
    expect(line((await july.get()).deductions, 'PF')).toBe(2_520);
    await ctx.http().post(`${API}/payroll/runs/${july.run.id}/cancel`).set(pm.h).send({});
    expect((await ctx.http().get(`${API}/payroll/statutory-rates?year=2026&month=7`).set(pm.h)).body.data.contribution).toMatchObject({ pfWageCeiling: 21_000, effectiveFrom: '2026-07-01' });
    expect((await ctx.http().get(`${API}/payroll/statutory-rates?year=2026&month=6`).set(asha.h)).status).toBe(403);

    // A year without its own rules borrows the latest ones, flagged as not confirmed.
    expect((await ctx.http().get(`${API}/payroll/statutory-rates?year=2028&month=4`).set(pm.h)).body.data.tax).toMatchObject({ financialYear: 2028, rulesYear: 2026, confirmed: false });

    // Rules entered for the current financial year replace the built-in ones when payroll is (re)calculated.
    const [cy, cm] = orgToday().split('-').map(Number) as [number, number];
    const fy = cm >= 4 ? cy : cy - 1;
    const current = await slip(cy, cm);
    expect(line((await current.get()).deductions, 'TDS')).toBeGreaterThan(0);
    const rules = overview.tax.find((t: { financialYear: number }) => t.financialYear === 2026).rules;
    const taxFree = { ...rules, NEW: { ...rules.NEW, slabs: [{ upTo: 5_000_000, rate: 0 }, { upTo: null, rate: 0.3 }] } };
    expect((await ctx.http().put(`${base}/tax/${fy}`).set(rh).send({ rules: { ...taxFree, NEW: { ...taxFree.NEW, slabs: [{ upTo: 100, rate: 0 }] } } })).status).toBe(422);
    expect((await ctx.http().put(`${base}/tax/2024`).set(rh).send({ rules: taxFree })).status).toBe(422);
    const entered = (await ctx.http().put(`${base}/tax/${fy}`).set(rh).send({ rules: taxFree, source: 'Finance Act (test)' })).body.data;
    expect(entered.tax.find((t: { financialYear: number }) => t.financialYear === fy)).toMatchObject({ source: 'ENTERED', confirmed: true, note: 'Finance Act (test)' });
    await ctx.http().post(`${API}/payroll/runs/${current.run.id}/calculate`).set(pm.h).send({});
    expect(line((await current.get()).deductions, 'TDS') ?? 0).toBe(0);

    // Removing entries brings the built-in values back.
    await ctx.http().delete(`${base}/tax/${fy}`).set(rh);
    const after = (await ctx.http().delete(`${base}/contribution/${saved.contribution.entries[0].id}`).set(rh)).body.data;
    expect(after.contribution.entries).toEqual([]);
    expect(after.tax.find((t: { financialYear: number }) => t.financialYear === fy)).toMatchObject({ source: 'BUILT_IN', confirmed: true });
  });
});
