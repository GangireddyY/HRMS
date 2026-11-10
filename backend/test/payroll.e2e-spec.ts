import { LeaveRequest, LeaveType, ReimbursementClaim } from '../src/database/models';
import { API, PASSWORD, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
type Line = { code: string; amount: number };
const line = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount;

describe('Payroll (e2e)', () => {
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

  /** Payroll manager (processes), finance manager (approves / pays), two employees and the standard structure. */
  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const blr = (await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Bengaluru', state: 'Karnataka' })).body.data;
    const pm = await person(org.organization.id, h, ['payroll_manager']);
    const finance = await person(org.organization.id, h, ['finance_manager']);
    const asha = await person(org.organization.id, h, ['employee'], { dateOfBirth: '1990-05-10', gender: 'FEMALE', locationId: blr.id });
    const ravi = await person(org.organization.id, h, ['employee'], { dateOfJoining: '2026-09-16', gender: 'MALE' });
    const sensitive = await ctx.http().put(`${API}/employees/${asha.employee.id}/sensitive`).set(h).send({ pan: 'ABCDE1234F', uan: '100200300400', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' });
    expect(sensitive.status).toBe(200);
    const rec = await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({});
    expect(rec.status).toBe(201);
    const structure = rec.body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    return { org, h, pm, finance, asha, ravi, structure };
  }

  it('configures structures and previews salaries with statutory contributions', async () => {
    const s = await setup();
    expect(s.structure.lines.map((l: { component: { code: string }; calculation: string }) => [l.component.code, l.calculation])).toEqual([
      ['BASIC', 'PERCENT_OF_CTC'],
      ['HRA', 'PERCENT_OF_BASIC'],
      ['SPECIAL', 'BALANCE'],
    ]);
    const preview = await ctx.http().post(`${API}/payroll/salaries/preview`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc: 240000 });
    expect(preview.body.data).toMatchObject({ monthlyGross: 18208, employerPf: 1200, employerEsi: 592, monthlyCtc: 20000 });

    // Structure rules: one balancing line, Basic required, and the balance can't feed PF wages.
    const lta = await ctx.http().post(`${API}/payroll/components`).set(s.h).send({ code: 'LTA', name: 'Leave travel allowance' });
    expect(lta.status).toBe(201);
    const components = (await ctx.http().get(`${API}/payroll/components`).set(s.h)).body.data as { id: string; code: string }[];
    const id = (code: string) => components.find((c) => c.code === code)!.id;
    const withLta = await ctx.http().post(`${API}/payroll/structures`).set(s.h).send({
      name: 'With LTA',
      lines: [{ componentId: id('BASIC'), calculation: 'PERCENT_OF_CTC', value: 50 }, { componentId: id('LTA'), calculation: 'FIXED', value: 20000 }, { componentId: id('SPECIAL'), calculation: 'BALANCE' }],
    });
    expect(withLta.status).toBe(201);
    const tooLow = await ctx.http().post(`${API}/payroll/salaries/preview`).set(s.pm.h).send({ structureId: withLta.body.data.id, annualCtc: 300000 });
    expect(tooLow.status).toBe(422);
    expect(tooLow.body.error.details[0].message).toMatch(/too low/);
    const bad = await ctx.http().post(`${API}/payroll/structures`).set(s.h).send({ name: 'Broken', lines: [{ componentId: id('HRA'), calculation: 'PERCENT_OF_CTC', value: 40 }, { componentId: id('SPECIAL'), calculation: 'FIXED', value: 1000 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.map((d: { message: string }) => d.message)).toEqual(expect.arrayContaining(['Exactly one component must be the balance', 'Include the Basic component']));
    const balanceOnBasic = await ctx.http().post(`${API}/payroll/structures`).set(s.h).send({ name: 'Bad basic', lines: [{ componentId: id('BASIC'), calculation: 'BALANCE' }, { componentId: id('HRA'), calculation: 'FIXED', value: 1000 }] });
    expect(balanceOnBasic.status).toBe(422);
    // Used structures can't be deleted.
    await ctx.http().post(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc: 600000, effectiveFrom: '2026-04-01' });
    expect((await ctx.http().delete(`${API}/payroll/structures/${s.structure.id}`).set(s.h)).status).toBe(409);

    // Nobody sets their own salary; employees see only their own.
    const own = await ctx.http().post(`${API}/payroll/employees/${s.pm.employee.id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc: 900000, effectiveFrom: '2026-04-01' });
    expect(own.status).toBe(403);
    expect((await ctx.http().get(`${API}/payroll/me/salary`).set(s.asha.h)).body.data.salaries).toHaveLength(1);
    expect((await ctx.http().get(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.ravi.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/payroll/salaries`).set(s.ravi.h)).status).toBe(403);
  });

  it('sends raises above the approval threshold to a second person', async () => {
    const s = await setup();
    const revise = (annualCtc: number, effectiveFrom: string) =>
      ctx.http().post(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc, effectiveFrom, reason: 'Revision' });
    const history = async () => (await ctx.http().get(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.pm.h)).body.data;
    expect((await revise(600000, '2026-04-01')).status).toBe(201);

    // The payroll manager configures payroll, but loosening the approval step is the checker's call.
    expect((await ctx.http().put(`${API}/payroll/settings`).set(s.pm.h).send({ salaryApprovalThresholdPct: 10 })).status).toBe(200);
    const loosen = await ctx.http().put(`${API}/payroll/settings`).set(s.pm.h).send({ salaryApprovalThresholdPct: null });
    expect(loosen.status).toBe(403);

    // Within the threshold: applied directly. Above it: a request, not a salary.
    const small = await revise(650000, '2026-10-01');
    expect(small.status).toBe(201);
    expect(small.body.data.annualCtc).toBe(650000);
    const big = await revise(800000, '2026-12-01');
    expect(big.status).toBe(201);
    expect(big.body.data).toMatchObject({ pendingApproval: true, request: { status: 'PENDING', previousCtc: 650000, annualCtc: 800000, mine: true, canReview: false } });
    expect(big.body.data.request.raisePercent).toBeCloseTo(23.08, 2);
    expect((await history()).salaries).toHaveLength(2);
    expect((await history()).pendingRevision).toMatchObject({ id: big.body.data.request.id });
    expect((await ctx.http().get(`${API}/payroll/me/salary`).set(s.asha.h)).body.data.pendingRevision).toBeNull();
    expect((await revise(900000, '2027-01-01')).status).toBe(409);

    // Neither the requester (no permission) nor the employee may approve; finance can.
    const id = big.body.data.request.id;
    expect((await ctx.http().post(`${API}/payroll/salary-revisions/${id}/approve`).set(s.pm.h).send({})).status).toBe(403);
    const queue = (await ctx.http().get(`${API}/payroll/salary-revisions`).set(s.finance.h)).body.data;
    expect(queue).toEqual([expect.objectContaining({ id, canReview: true, requestedBy: expect.any(String) })]);
    const approved = await ctx.http().post(`${API}/payroll/salary-revisions/${id}/approve`).set(s.finance.h).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    const after = await history();
    expect(after.pendingRevision).toBeNull();
    expect(after.salaries.map((x: { annualCtc: number }) => x.annualCtc)).toEqual([800000, 650000, 600000]);
    expect((await ctx.http().post(`${API}/payroll/salary-revisions/${id}/approve`).set(s.finance.h).send({})).status).toBe(409);

    // Rejection needs a reason; the requester can withdraw instead.
    const next = (await revise(1200000, '2027-01-01')).body.data.request;
    expect((await ctx.http().post(`${API}/payroll/salary-revisions/${next.id}/reject`).set(s.finance.h).send({})).status).toBe(422);
    const rejected = await ctx.http().post(`${API}/payroll/salary-revisions/${next.id}/reject`).set(s.finance.h).send({ note: 'Above the band for the role' });
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', reviewNote: 'Above the band for the role' });
    const third = (await revise(1000000, '2027-02-01')).body.data.request;
    expect((await ctx.http().post(`${API}/payroll/salary-revisions/${third.id}/cancel`).set(s.finance.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/payroll/salary-revisions/${third.id}/cancel`).set(s.pm.h).send({})).status).toBe(201);
    expect((await history()).salaries).toHaveLength(3);

    // The admin (who holds the approval permission) may switch the step off.
    expect((await ctx.http().put(`${API}/payroll/settings`).set(s.h).send({ salaryApprovalThresholdPct: null })).status).toBe(200);
    expect((await revise(2000000, '2027-03-01')).body.data.annualCtc).toBe(2000000);
  });

  it('runs payroll with loss of pay, PF, ESI, professional tax and TDS, approved by someone else', async () => {
    const s = await setup();
    const salary = (id: string, annualCtc: number, effectiveFrom: string) => ctx.http().post(`${API}/payroll/employees/${id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc, effectiveFrom });
    expect((await salary(s.asha.employee.id, 2400000, '2026-04-01')).status).toBe(201);
    expect((await salary(s.ravi.employee.id, 240000, '2026-09-16')).status).toBe(201);

    const created = await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 9 });
    expect(created.status).toBe(201);
    const runId = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'DRAFT', employeeCount: 2 });
    expect(created.body.data.missingSalary.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining([s.pm.employee.id, s.finance.employee.id]));
    const slips = (await ctx.http().get(`${API}/payroll/runs/${runId}/payslips`).set(s.pm.h)).body.data as { id: string; employeeId: string }[];
    const slipOf = (employeeId: string) => slips.find((p) => p.employeeId === employeeId)!.id;

    // Asha: full month, ₹24 lakh CTC → TDS spread over the 7 months left (no earlier payslips this year).
    let asha = (await ctx.http().get(`${API}/payroll/payslips/${slipOf(s.asha.employee.id)}`).set(s.pm.h)).body.data;
    expect(asha).toMatchObject({ gross: 198200, employedDays: 30, lopDays: 0 });
    expect(line(asha.deductions, 'TDS')).toBe(11419);

    // One day of loss of pay: earnings prorated over 30 days; PF stays capped at the ₹15,000 ceiling.
    asha = (await ctx.http().patch(`${API}/payroll/runs/${runId}/payslips/${asha.id}`).set(s.pm.h).send({ lopOverride: 1 })).body.data;
    expect(asha).toMatchObject({ gross: 191593, payableDays: 29, lopOverride: 1 });
    expect([line(asha.earnings, 'BASIC'), line(asha.earnings, 'HRA'), line(asha.earnings, 'SPECIAL')]).toEqual([96667, 48333, 46593]);
    expect([line(asha.deductions, 'PF'), line(asha.deductions, 'PT'), line(asha.deductions, 'TDS'), line(asha.deductions, 'ESI')]).toEqual([1800, 200, 11272, undefined]);
    expect([line(asha.employerContributions, 'EPF'), line(asha.employerContributions, 'EPS')]).toEqual([550, 1250]);
    expect(asha.netPay).toBe(178321);
    expect(asha.employee).toMatchObject({ pan: '••••••234F', uan: '••••••••0400', bank: { accountLast4: '9012', ifsc: 'HDFC0001234' } });

    // Ravi joined on the 16th: half a month, covered by ESI (gross under ₹21,000), no professional tax state.
    let ravi = (await ctx.http().get(`${API}/payroll/payslips/${slipOf(s.ravi.employee.id)}`).set(s.pm.h)).body.data;
    expect(ravi).toMatchObject({ employedDays: 15, gross: 9104, netPay: 8435 });
    expect([line(ravi.deductions, 'PF'), line(ravi.deductions, 'ESI'), line(ravi.employerContributions, 'ESI_ER'), line(ravi.employerContributions, 'EPS')]).toEqual([600, 69, 296, 417]);
    expect(ravi.warnings).toEqual(expect.arrayContaining(['No UAN recorded (needed for the PF return)', 'No bank account recorded (not included in the bank file)']));
    ravi = (await ctx.http().post(`${API}/payroll/runs/${runId}/adjustments`).set(s.pm.h).send({ employeeId: s.ravi.employee.id, kind: 'EARNING', label: 'Joining bonus', amount: 10000 })).body.data;
    expect(ravi).toMatchObject({ gross: 19104, netPay: 18435 });
    expect(line(ravi.deductions, 'ESI')).toBe(69);

    // Employees can't see draft payslips; the processor can't approve.
    expect((await ctx.http().get(`${API}/payroll/payslips/${asha.id}`).set(s.asha.h)).status).toBe(404);
    expect((await ctx.http().post(`${API}/payroll/runs/${runId}/approve`).set(s.pm.h).send({})).status).toBe(403);

    // The org admin submits (recalculating it), so must not approve it either.
    const submitted = await ctx.http().post(`${API}/payroll/runs/${runId}/submit`).set(s.h).send({});
    expect(submitted.body.data).toMatchObject({ status: 'SUBMITTED', totalNet: 178321 + 18435 });
    expect((await ctx.http().post(`${API}/payroll/runs/${runId}/approve`).set(s.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/payroll/me/payslips`).set(s.asha.h)).body.data).toEqual([]);
    const approved = await ctx.http().post(`${API}/payroll/runs/${runId}/approve`).set(s.finance.h).send({ note: 'Checked' });
    expect(approved.body.data.status).toBe('APPROVED');

    // Published: Asha sees her payslip, Ravi can't see hers.
    const mine = (await ctx.http().get(`${API}/payroll/me/payslips`).set(s.asha.h)).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: asha.id, period: 'September 2026', netPay: 178321 })]);
    expect((await ctx.http().get(`${API}/payroll/payslips/${asha.id}`).set(s.asha.h)).body.data.tax).toMatchObject({ regime: 'NEW', thisMonth: 11272 });
    expect((await ctx.http().get(`${API}/payroll/payslips/${asha.id}`).set(s.ravi.h)).status).toBe(404);

    // Exports: the bank file (disbursers only) and the PF ECR, both after re-confirming identity (step-up).
    expect((await ctx.http().get(`${API}/payroll/runs/${runId}/bank-file`).set(s.pm.h)).status).toBe(403);
    const unconfirmed = await ctx.http().get(`${API}/payroll/runs/${runId}/bank-file`).set(s.finance.h);
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await ctx.http().post(`${API}/auth/step-up`).set(s.finance.h).send({ password: 'wrong-password' })).status).toBe(401);
    expect((await ctx.http().post(`${API}/auth/step-up`).set(s.finance.h).send({ password: PASSWORD })).status).toBe(200);
    expect((await ctx.http().post(`${API}/auth/step-up`).set(s.pm.h).send({ password: PASSWORD })).status).toBe(200);
    const bank = await ctx.http().get(`${API}/payroll/runs/${runId}/bank-file`).set(s.finance.h);
    expect(bank.text).toContain('123456789012,HDFC0001234,HDFC Bank,178321.00,SALARY SEP 2026');
    expect(bank.text.split('\r\n').filter(Boolean)).toHaveLength(2);
    const ecr = await ctx.http().get(`${API}/payroll/runs/${runId}/pf-ecr`).set(s.pm.h);
    expect(ecr.text.trim()).toBe(`100200300400#~#${s.asha.user.firstName.toUpperCase()} PERSON#~#191593#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#1#~#0`);
    const register = await ctx.http().get(`${API}/payroll/runs/${runId}/register`).set(s.pm.h);
    expect(register.text).toContain('Joining bonus');

    const paid = await ctx.http().post(`${API}/payroll/runs/${runId}/pay`).set(s.finance.h).send({ paymentReference: 'NEFT-0930' });
    expect(paid.body.data).toMatchObject({ status: 'PAID', paymentReference: 'NEFT-0930' });

    // Revisions can reach back into processed months (paid as arrears) only up to 12 months.
    expect((await salary(s.asha.employee.id, 2600000, '2025-08-01')).status).toBe(422);
    // Other tenants see nothing.
    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/payroll/runs/${runId}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/payroll/payslips/${asha.id}`).set(oh)).status).toBe(404);
  });

  it('takes unpaid leave and approved reimbursements into the next run, with year-to-date tax', async () => {
    const s = await setup();
    await ctx.http().post(`${API}/payroll/employees/${s.asha.employee.id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc: 2400000, effectiveFrom: '2026-04-01' });
    await ctx.http().post(`${API}/payroll/employees/${s.ravi.employee.id}/salaries`).set(s.pm.h).send({ structureId: s.structure.id, annualCtc: 240000, effectiveFrom: '2026-09-16' });

    // September: one day loss of pay for Asha, approved and paid.
    const sep = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 9 })).body.data;
    const sepSlips = (await ctx.http().get(`${API}/payroll/runs/${sep.id}/payslips`).set(s.pm.h)).body.data as { id: string; employeeId: string }[];
    await ctx.http().patch(`${API}/payroll/runs/${sep.id}/payslips/${sepSlips.find((p) => p.employeeId === s.asha.employee.id)!.id}`).set(s.pm.h).send({ lopOverride: 1 });
    // A second run can't start while one is in progress.
    expect((await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).status).toBe(409);
    await ctx.http().post(`${API}/payroll/runs/${sep.id}/submit`).set(s.pm.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${sep.id}/approve`).set(s.finance.h).send({});

    // Reimbursements: claimants never approve their own claims.
    const claim = await ctx.http().post(`${API}/payroll/reimbursements`).set(s.ravi.h).field('category', 'TRAVEL').field('title', 'Client visit cab').field('expenseDate', '2026-10-05').field('amount', '1200').attach('file', PDF, 'cab.pdf');
    expect(claim.status).toBe(201);
    expect(claim.body.data).toMatchObject({ status: 'PENDING', amount: 1200, receipt: { fileName: 'cab.pdf', contentType: 'application/pdf' } });
    const own = await ctx.http().post(`${API}/payroll/reimbursements`).set(s.finance.h).field('category', 'FOOD').field('title', 'Team lunch').field('expenseDate', '2026-10-06').field('amount', '500');
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${own.body.data.id}/approve`).set(s.finance.h).send({})).status).toBe(403);
    const fake = await ctx.http().post(`${API}/payroll/reimbursements`).set(s.ravi.h).field('category', 'OTHER').field('title', 'Not a receipt').field('expenseDate', '2026-10-05').field('amount', '10').attach('file', Buffer.from('hello'), 'x.pdf');
    expect(fake.status).toBe(422);
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${claim.body.data.id}/reject`).set(s.finance.h).send({})).status).toBe(422);
    expect((await ctx.http().post(`${API}/payroll/reimbursements/${claim.body.data.id}/approve`).set(s.finance.h).send({})).body.data.status).toBe('APPROVED');
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${claim.body.data.id}/receipt`).set(s.finance.h)).status).toBe(200);
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${claim.body.data.id}`).set(s.asha.h)).status).toBe(404);

    // Unpaid leave on Wednesday 7 October (fixture: the leave module's approval flow is covered by its own tests).
    const lwp = await LeaveType.create({ organizationId: s.org.organization.id, code: 'LWP', name: 'Leave without pay', isPaid: false, unlimited: true, accrualFrequency: 'NONE' }, RAW);
    await LeaveRequest.create(
      { organizationId: s.org.organization.id, employeeId: s.asha.employee.id, leaveTypeId: lwp.id, leaveYear: 2026, startDate: '2026-10-07', endDate: '2026-10-07', days: '1', reason: 'Personal work', status: 'APPROVED' },
      RAW,
    );

    const oct = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).body.data;
    const octSlips = (await ctx.http().get(`${API}/payroll/runs/${oct.id}/payslips`).set(s.pm.h)).body.data as { id: string; employeeId: string }[];
    const asha = (await ctx.http().get(`${API}/payroll/payslips/${octSlips.find((p) => p.employeeId === s.asha.employee.id)!.id}`).set(s.pm.h)).body.data;
    // 30 of 31 days paid; TDS = (year's tax − September's 11,272) spread over the 6 months left.
    expect(asha).toMatchObject({ lopDays: 1, payableDays: 30, gross: 191806 });
    expect(line(asha.deductions, 'TDS')).toBe(11106);
    expect(asha.tax).toMatchObject({ alreadyDeducted: 11272, monthsLeftIncludingThis: 6 });

    const ravi = (await ctx.http().get(`${API}/payroll/payslips/${octSlips.find((p) => p.employeeId === s.ravi.employee.id)!.id}`).set(s.pm.h)).body.data;
    expect(line(ravi.earnings, 'REIMBURSEMENT')).toBe(1200);
    expect(ravi.statutory.esiCovered).toBe(true);
    expect((await ReimbursementClaim.findByPk(claim.body.data.id, RAW))!.payrollRunId).toBe(oct.id);

    // Holding Ravi's salary takes the claim out of the run again.
    await ctx.http().patch(`${API}/payroll/runs/${oct.id}/payslips/${ravi.id}`).set(s.pm.h).send({ excluded: true, excludeReason: 'Bank details pending' });
    expect((await ReimbursementClaim.findByPk(claim.body.data.id, RAW))!.payrollRunId).toBeNull();
    await ctx.http().patch(`${API}/payroll/runs/${oct.id}/payslips/${ravi.id}`).set(s.pm.h).send({ excluded: false });
    expect((await ReimbursementClaim.findByPk(claim.body.data.id, RAW))!.payrollRunId).toBe(oct.id);

    await ctx.http().post(`${API}/payroll/runs/${oct.id}/submit`).set(s.pm.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${oct.id}/approve`).set(s.finance.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${oct.id}/pay`).set(s.finance.h).send({ paymentReference: 'NEFT-1031' });
    expect((await ctx.http().get(`${API}/payroll/reimbursements/${claim.body.data.id}`).set(s.ravi.h)).body.data).toMatchObject({ status: 'PAID', payroll: { period: 'October 2026' } });
  });

  it('keeps tax declarations per employee and financial year', async () => {
    const s = await setup();
    const saved = await ctx.http().put(`${API}/payroll/me/tax-declaration?fy=2026`).set(s.asha.h).send({ regime: 'OLD', rentPaidAnnual: 300000, metroCity: true, section80c: 100000 });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ financialYear: 2026, regime: 'OLD', rentPaidAnnual: 300000, section80c: 100000 });
    // HR (payroll.process) can read and correct it; other employees can't.
    expect((await ctx.http().get(`${API}/payroll/employees/${s.asha.employee.id}/tax-declaration?fy=2026`).set(s.pm.h)).body.data.regime).toBe('OLD');
    expect((await ctx.http().get(`${API}/payroll/employees/${s.asha.employee.id}/tax-declaration?fy=2026`).set(s.ravi.h)).status).toBe(403);
    expect((await ctx.http().put(`${API}/payroll/me/tax-declaration?fy=2019`).set(s.asha.h).send({ regime: 'NEW' })).status).toBe(422);
  });
});
