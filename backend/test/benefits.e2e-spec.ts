import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays as days, orgToday, resetDatabase, uniqueEmail } from './helpers';

const iso = (d: Date) => d.toISOString().slice(0, 10);
type Line = { code: string; name: string; amount: number };

describe('Benefits (e2e)', () => {
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

  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema');
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { dateOfBirth: '1990-05-10', gender: 'FEMALE' });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { dateOfJoining: days(-10) });
    const chen = await person(org.organization.id, h, ['employee'], 'Chen', { employmentType: 'INTERN' });
    const family = async (name: string, relationship: string, dateOfBirth: string | null) => {
      const res = await ctx.http().post(`${API}/employees/${asha.employee.id}/family`).set(h).send({ name, relationship, dateOfBirth, isDependent: true });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    return { org, h, hr, asha, ben, chen, family };
  }

  const healthPlan = (over: Record<string, unknown> = {}) => ({
    name: 'Group health 2026',
    type: 'HEALTH',
    provider: 'Star Health',
    policyNumber: 'GMC-2026-001',
    coverageStartsOn: days(-40),
    coverageEndsOn: days(300),
    enrollmentOpensOn: days(-2),
    enrollmentClosesOn: days(10),
    employmentTypes: ['FULL_TIME'],
    maxChildAge: 25,
    options: [
      { name: 'Employee only', coverageAmount: 300000, employeeMonthly: 0, employerMonthly: 500, allowedRelations: [], maxDependents: 0 },
      { name: 'Family', coverageAmount: 500000, employeeMonthly: 750, employerMonthly: 1500, allowedRelations: ['SPOUSE', 'CHILD'], maxDependents: 3 },
    ],
    ...over,
  });

  it('enrols employees with dependants in windows, changes cover after a life event with approval, and exports the census', async () => {
    const t = await team();
    const spouse = await t.family('Ravi Kumar', 'SPOUSE', '1988-02-01');
    const child = await t.family('Anu Kumar', 'CHILD', '2018-05-01');
    const father = await t.family('Mohan Rao', 'FATHER', '1960-01-01');

    // Plan rules.
    expect((await ctx.http().post(`${API}/benefits/plans`).set(t.hr.h).send(healthPlan({ mandatory: true }))).status).toBe(422);
    const noRelations = healthPlan();
    noRelations.options[1] = { ...noRelations.options[1]!, allowedRelations: [] };
    expect((await ctx.http().post(`${API}/benefits/plans`).set(t.hr.h).send(noRelations)).status).toBe(422);
    expect((await ctx.http().post(`${API}/benefits/plans`).set(t.asha.h).send(healthPlan())).status).toBe(403);
    const created = await ctx.http().post(`${API}/benefits/plans`).set(t.hr.h).send(healthPlan());
    expect(created.status).toBe(201);
    const plan = created.body.data;
    const [solo, familyOption] = plan.options as { id: string; name: string }[];
    expect((await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data.plans).toEqual([]);
    await ctx.http().post(`${API}/benefits/plans/${plan.id}/activate`).set(t.hr.h).send({});

    // Eligibility: interns aren't offered the plan.
    expect((await ctx.http().get(`${API}/benefits/me`).set(t.chen.h)).body.data.plans).toEqual([]);
    expect((await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.chen.h).send({ optionId: solo!.id, dependentIds: [] })).status).toBe(403);

    const mine = (await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data;
    expect(mine.plans[0]).toMatchObject({ id: plan.id, window: { kind: 'OPEN_ENROLLMENT', closesOn: days(10) }, current: null, ineligible: null });
    expect(mine.dependents.map((d: { name: string }) => d.name)).toEqual(['Anu Kumar', 'Mohan Rao', 'Ravi Kumar']);

    // Dependants must be covered by the option.
    const withFather = await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [spouse, father] });
    expect(withFather.status).toBe(422);
    expect(withFather.body.error.details.map((d: { message: string }) => d.message)).toEqual(["Mohan Rao (father) isn't covered by this option"]);
    const enrolled = await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [spouse, child] });
    expect(enrolled.status).toBe(201);
    expect(enrolled.body.data).toMatchObject({ status: 'ACTIVE', reason: 'OPEN_ENROLLMENT', effectiveFrom: days(0), employeeMonthly: 750, coverageAmount: 500000, option: { name: 'Family' } });
    expect(enrolled.body.data.dependents.map((d: { name: string }) => d.name).sort()).toEqual(['Anu Kumar', 'Ravi Kumar']);
    expect((await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [child, spouse] })).status).toBe(409);
    expect((await ctx.http().post(`${API}/benefits/plans/${plan.id}/waive`).set(t.asha.h).send({})).status).toBe(409);
    const waived = await ctx.http().post(`${API}/benefits/plans/${plan.id}/waive`).set(t.ben.h).send({ note: 'Covered by my spouse’s policy' });
    expect(waived.body.data).toMatchObject({ status: 'WAIVED', option: null });

    const stats = (await ctx.http().get(`${API}/benefits/plans/${plan.id}`).set(t.hr.h)).body.data.stats;
    expect(stats).toEqual({ enrolled: 1, pending: 0, waived: 1, employeeMonthly: 750, employerMonthly: 1500 });
    expect((await ctx.http().get(`${API}/benefits/plans/${plan.id}`).set(t.asha.h)).body.data.stats).toBeUndefined();

    // Active plans: type and start are fixed; options in use can't be removed.
    expect((await ctx.http().patch(`${API}/benefits/plans/${plan.id}`).set(t.hr.h).send({ type: 'LIFE' })).status).toBe(409);
    expect((await ctx.http().patch(`${API}/benefits/plans/${plan.id}`).set(t.hr.h).send({ options: [{ ...plan.options[0] }] })).status).toBe(409);

    // After the window closes, changes need a life event from the last 30 days and HR approval.
    await ctx.http().patch(`${API}/benefits/plans/${plan.id}`).set(t.hr.h).send({ enrollmentOpensOn: days(-30), enrollmentClosesOn: days(-20) });
    const baby = await t.family('Isha Kumar', 'CHILD', days(-3));
    const closed = await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [spouse, child, baby] });
    expect(closed.status).toBe(409);
    expect((await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [spouse, child, baby], lifeEvent: 'CHILDBIRTH', lifeEventDate: days(-45) })).status).toBe(422);
    const change = await ctx.http().post(`${API}/benefits/plans/${plan.id}/enroll`).set(t.asha.h).send({ optionId: familyOption!.id, dependentIds: [spouse, child, baby], lifeEvent: 'CHILDBIRTH', lifeEventDate: days(-3) });
    expect(change.body.data).toMatchObject({ status: 'PENDING', reason: 'LIFE_EVENT', effectiveFrom: days(-3), replacesId: enrolled.body.data.id });
    const now = (await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data.plans[0];
    expect([now.current.id, now.pending.id]).toEqual([enrolled.body.data.id, change.body.data.id]);

    const pending = (await ctx.http().get(`${API}/benefits/enrollments?status=PENDING`).set(t.hr.h)).body.data;
    expect(pending.map((e: { id: string }) => e.id)).toEqual([change.body.data.id]);
    expect((await ctx.http().post(`${API}/benefits/enrollments/${change.body.data.id}/approve`).set(t.asha.h).send({})).status).toBe(403);
    const approved = await ctx.http().post(`${API}/benefits/enrollments/${change.body.data.id}/approve`).set(t.hr.h).send({ note: 'Birth certificate seen' });
    expect(approved.body.data).toMatchObject({ status: 'ACTIVE', decidedBy: 'Hema Person', decisionNote: 'Birth certificate seen' });
    // The new cover starts before the old one did, so the old one never applies.
    const history = (await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data.history;
    expect(history.map((e: { id: string; status: string }) => [e.id, e.status])).toEqual([[enrolled.body.data.id, 'CANCELLED']]);

    // Insurer census: the employee and each dependant.
    const census = await ctx.http().get(`${API}/benefits/plans/${plan.id}/census`).set(t.hr.h);
    expect(census.status).toBe(200);
    const rows = census.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(rows).toHaveLength(5);
    expect(rows.slice(1).map((r) => r.split(',')[3]).sort()).toEqual(['CHILD', 'CHILD', 'SELF', 'SPOUSE']);
    expect((await ctx.http().get(`${API}/benefits/plans/${plan.id}/census`).set(t.asha.h)).status).toBe(403);

    // HR ends coverage; the employee is told.
    const ended = await ctx.http().post(`${API}/benefits/enrollments/${approved.body.data.id}/end`).set(t.hr.h).send({ effectiveTo: days(5), note: 'Moved to the spouse’s policy' });
    expect(ended.body.data).toMatchObject({ status: 'ENDED', effectiveTo: days(5) });

    // Tenant isolation.
    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/benefits/plans/${plan.id}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/benefits/enrollments`).set(oh)).body.data).toEqual([]);
  });

  it('covers everyone eligible in a mandatory plan and deducts contributions in payroll', async () => {
    const t = await team();
    const now = new Date(`${orgToday()}T00:00:00Z`);
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const start = iso(prev);
    const life = await ctx.http().post(`${API}/benefits/plans`).set(t.h).send({
      name: 'Group term life',
      type: 'LIFE',
      mandatory: true,
      coverageStartsOn: start,
      coverageEndsOn: days(330),
      employmentTypes: ['FULL_TIME'],
      options: [{ name: 'Standard', coverageAmount: 1000000, employeeMonthly: 200, employerMonthly: 300, allowedRelations: [], maxDependents: 0, isDefault: true }],
    });
    expect(life.status).toBe(201);
    const id = life.body.data.id;
    expect((await ctx.http().post(`${API}/benefits/plans/${id}/enroll-eligible`).set(t.h).send({})).status).toBe(409);
    await ctx.http().post(`${API}/benefits/plans/${id}/activate`).set(t.h).send({});
    // Hema, Asha and Ben are full time; Chen is an intern.
    expect((await ctx.http().post(`${API}/benefits/plans/${id}/enroll-eligible`).set(t.h).send({})).body.data).toEqual({ enrolled: 3 });
    expect((await ctx.http().post(`${API}/benefits/plans/${id}/enroll-eligible`).set(t.h).send({})).body.data).toEqual({ enrolled: 0 });
    expect((await ctx.http().post(`${API}/benefits/plans/${id}/waive`).set(t.asha.h).send({})).status).toBe(409);
    const asha = (await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data;
    expect(asha.plans[0].current).toMatchObject({ status: 'ACTIVE', reason: 'HR', effectiveFrom: start, option: { name: 'Standard' } });
    expect(asha.monthlyContribution).toBe(200);
    const ben = (await ctx.http().get(`${API}/benefits/me`).set(t.ben.h)).body.data;
    expect(ben.plans[0].current.effectiveFrom).toBe(days(-10));

    // Payroll for last month deducts Asha's contribution (Ben only joined this month).
    const rec = await ctx.http().post(`${API}/payroll/structures/recommended`).set(t.h).send({});
    const structure = rec.body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    expect((await ctx.http().post(`${API}/payroll/employees/${t.asha.employee.id}/salaries`).set(t.h).send({ structureId: structure.id, annualCtc: 600000, effectiveFrom: '2024-01-08' })).status).toBe(201);
    const run = await ctx.http().post(`${API}/payroll/runs`).set(t.h).send({ year: prev.getUTCFullYear(), month: prev.getUTCMonth() + 1 });
    expect(run.status).toBe(201);
    const slips = (await ctx.http().get(`${API}/payroll/runs/${run.body.data.id}/payslips`).set(t.h)).body.data as { id: string; employeeId: string }[];
    const slip = (await ctx.http().get(`${API}/payroll/payslips/${slips.find((p) => p.employeeId === t.asha.employee.id)!.id}`).set(t.h)).body.data;
    const benefit = (slip.deductions as Line[]).find((l) => l.code.startsWith('BEN_'));
    expect(benefit).toEqual({ code: `BEN_${id.slice(0, 8)}`, name: 'Group term life (Standard)', amount: 200 });
  });

  it('renews a plan for the next policy period and carries enrolments over', async () => {
    const t = await team();
    const spouse = await t.family('Ravi Kumar', 'SPOUSE', '1988-02-01');
    const child = await t.family('Anu Kumar', 'CHILD', '2018-05-01');
    const current = (await ctx.http().post(`${API}/benefits/plans`).set(t.hr.h).send(healthPlan({ coverageStartsOn: days(-300), coverageEndsOn: days(20) }))).body.data;
    expect((await ctx.http().post(`${API}/benefits/plans/${current.id}/renew`).set(t.hr.h).send({})).status).toBe(409);
    await ctx.http().post(`${API}/benefits/plans/${current.id}/activate`).set(t.hr.h).send({});
    const family = current.options.find((o: { name: string }) => o.name === 'Family');
    const self = current.options.find((o: { name: string }) => o.name === 'Employee only');
    expect((await ctx.http().post(`${API}/benefits/plans/${current.id}/enroll`).set(t.asha.h).send({ optionId: family.id, dependentIds: [spouse, child] })).status).toBe(201);
    expect((await ctx.http().post(`${API}/benefits/plans/${current.id}/enroll`).set(t.ben.h).send({ optionId: self.id, dependentIds: [] })).status).toBe(201);

    // The renewal is a draft for the next period, with the same options and a window just before it starts.
    expect((await ctx.http().post(`${API}/benefits/plans/${current.id}/renew`).set(t.asha.h).send({})).status).toBe(403);
    const renewal = await ctx.http().post(`${API}/benefits/plans/${current.id}/renew`).set(t.hr.h).send({ name: 'Group health 2027' });
    expect(renewal.status).toBe(201);
    expect(renewal.body.data).toMatchObject({ status: 'DRAFT', name: 'Group health 2027', renewedFromId: current.id, coverageStartsOn: days(21), enrollmentOpensOn: days(0), enrollmentClosesOn: days(20), renewedFrom: { id: current.id } });
    expect(renewal.body.data.options.map((o: { name: string }) => o.name)).toEqual(['Employee only', 'Family']);
    expect((await ctx.http().post(`${API}/benefits/plans/${current.id}/renew`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().get(`${API}/benefits/plans/${current.id}`).set(t.hr.h)).body.data.renewal).toMatchObject({ id: renewal.body.data.id, status: 'DRAFT' });

    // New terms: dearer family cover, a lower age limit for children, and the single option renamed as the default.
    const next = renewal.body.data;
    const options = next.options.map((o: Record<string, unknown>) => (o.name === 'Family' ? { ...o, employeeMonthly: 900 } : { ...o, name: 'Self', isDefault: true }));
    expect((await ctx.http().patch(`${API}/benefits/plans/${next.id}`).set(t.hr.h).send({ maxChildAge: 7, options })).status).toBe(200);
    const activated = await ctx.http().post(`${API}/benefits/plans/${next.id}/activate`).set(t.hr.h).send({});
    expect(activated.body.data).toMatchObject({ status: 'ACTIVE', carriedOver: { carried: 2, skipped: 0 } });

    const renewed = (await ctx.http().get(`${API}/benefits/enrollments?planId=${next.id}`).set(t.hr.h)).body.data as { employee: { name: string }; reason: string; effectiveFrom: string; option: { name: string }; employeeMonthly: number; dependents: { name: string }[] }[];
    const asha = renewed.find((e) => e.employee.name === 'Asha Person')!;
    expect(asha).toMatchObject({ reason: 'RENEWAL', effectiveFrom: days(21), option: { name: 'Family' }, employeeMonthly: 900 });
    expect(asha.dependents.map((d) => d.name)).toEqual(['Ravi Kumar']);
    expect(renewed.find((e) => e.employee.name === 'Ben Person')).toMatchObject({ option: { name: 'Self' } });
    const previous = (await ctx.http().get(`${API}/benefits/enrollments?planId=${current.id}`).set(t.hr.h)).body.data as { employee: { name: string }; effectiveTo: string | null }[];
    expect(previous.find((e) => e.employee.name === 'Asha Person')!.effectiveTo).toBe(days(20));

    // During the renewal window Asha can still switch, replacing the carried-over choice before it starts.
    const mine = (await ctx.http().get(`${API}/benefits/me`).set(t.asha.h)).body.data.plans.find((p: { id: string }) => p.id === next.id);
    expect(mine).toMatchObject({ window: { kind: 'OPEN_ENROLLMENT' }, current: { reason: 'RENEWAL' } });
    const selfOption = next.options.find((o: { name: string }) => o.name === 'Employee only');
    expect((await ctx.http().post(`${API}/benefits/plans/${next.id}/enroll`).set(t.asha.h).send({ optionId: selfOption.id, dependentIds: [] })).body.data).toMatchObject({ status: 'ACTIVE', effectiveFrom: days(21), option: { name: 'Self' } });
  });
});
