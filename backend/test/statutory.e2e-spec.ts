import { API, PASSWORD, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
type Line = { code: string; amount: number };
const line = (lines: Line[], code: string) => lines.find((l) => l.code === code)?.amount;

describe('India statutory payroll (e2e)', () => {
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
    const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx
      .http()
      .post(`${API}/employees`)
      .set(h)
      .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  it('verifies proofs, deducts labour welfare fund and produces the returns, Form 16 and Form 12BB', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const mumbai = (await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Mumbai', state: 'Maharashtra' })).body.data;
    const pm = await person(org.organization.id, h, ['payroll_manager']);
    const finance = await person(org.organization.id, h, ['finance_manager']);
    const asha = await person(org.organization.id, h, ['employee'], { dateOfBirth: '1990-05-10', gender: 'FEMALE', locationId: mumbai.id });
    const ravi = await person(org.organization.id, h, ['employee'], { gender: 'MALE' });
    await ctx.http().put(`${API}/employees/${asha.employee.id}/sensitive`).set(h).send({ pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' });
    expect((await ctx.http().put(`${API}/employees/${ravi.employee.id}/sensitive`).set(h).send({ esiNumber: '31-0012' })).status).toBe(422);
    expect((await ctx.http().put(`${API}/employees/${ravi.employee.id}/sensitive`).set(h).send({ esiNumber: '3100123456' })).body.data.esiNumber).toBe('3100123456');
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    for (const [who, ctc] of [
      [asha, 1500000],
      [ravi, 240000],
    ] as const) {
      expect((await ctx.http().post(`${API}/payroll/employees/${who.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: ctc, effectiveFrom: '2026-04-01' })).status).toBe(
        201,
      );
    }
    expect((await ctx.http().put(`${API}/payroll/settings`).set(pm.h).send({ lwfEnabled: true, proofsFromMonth: 1 })).body.data).toMatchObject({ lwfEnabled: true, proofsFromMonth: 1 });

    // Declaration and proofs for FY 2026-27.
    expect((await ctx.http().put(`${API}/payroll/me/tax-declaration?fy=2026`).set(asha.h).send({ regime: 'OLD', section80c: 150000, rentPaidAnnual: 240000 })).status).toBe(200);
    const upload = (section: string, amount: number, description: string, file = PDF) =>
      ctx
        .http()
        .post(`${API}/payroll/me/tax-proofs`)
        .set(asha.h)
        .field('fy', '2026')
        .field('section', section)
        .field('amount', String(amount))
        .field('description', description)
        .attach('file', file, 'proof.pdf');
    expect((await upload('80C', 100000, 'Notes', Buffer.from('not a document'))).status).toBe(422);
    const ppf = await upload('80C', 100000, 'PPF deposit, SBI');
    expect(ppf.status).toBe(201);
    const rent = await upload('HRA', 240000, 'Rent receipts April–March');
    expect(rent.body.data).toMatchObject({ status: 'SUBMITTED', sectionLabel: expect.stringContaining('House rent') });

    expect((await ctx.http().post(`${API}/payroll/tax-proofs/${ppf.body.data.id}/accept`).set(asha.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/payroll/tax-proofs/${ppf.body.data.id}/accept`).set(pm.h).send({ amount: 120000 })).status).toBe(422);
    expect((await ctx.http().post(`${API}/payroll/tax-proofs/${ppf.body.data.id}/accept`).set(pm.h).send({ amount: 80000, note: 'One receipt is for FY 2025-26' })).body.data).toMatchObject({
      status: 'ACCEPTED',
      acceptedAmount: 80000,
    });
    expect((await ctx.http().post(`${API}/payroll/tax-proofs/${rent.body.data.id}/reject`).set(pm.h).send({ note: 'Landlord PAN missing' })).body.data.status).toBe('REJECTED');
    expect((await ctx.http().delete(`${API}/payroll/me/tax-proofs/${ppf.body.data.id}`).set(asha.h)).status).toBe(409);
    const mine = (await ctx.http().get(`${API}/payroll/me/tax-proofs?fy=2026`).set(asha.h)).body.data;
    expect(mine.sections.find((s: { section: string }) => s.section === '80C')).toMatchObject({ declared: 150000, submitted: 100000, accepted: 80000 });
    expect(mine.sections.find((s: { section: string }) => s.section === 'HRA')).toMatchObject({ declared: 240000, submitted: 0, accepted: 0 });
    expect((await ctx.http().get(`${API}/payroll/tax-proofs/${ppf.body.data.id}/file`).set(asha.h)).status).toBe(200);
    expect((await ctx.http().get(`${API}/payroll/tax-proofs/${ppf.body.data.id}/file`).set(ravi.h)).status).toBe(404);

    // June: Maharashtra collects LWF (₹25 + ₹75); the cut-off isn't reached yet, so the declaration counts.
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(pm.h).send({ year: 2026, month: 6 })).body.data;
    type Slip = { deductions: Line[]; employerContributions: Line[]; warnings: string[] };
    const slipId = ((await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(pm.h)).body.data as { id: string; employeeId: string }[]).find((p) => p.employeeId === asha.employee.id)!.id;
    const load = async () => (await ctx.http().get(`${API}/payroll/payslips/${slipId}`).set(pm.h)).body.data as Slip;
    let slip = await load();
    const ashaSlip = () => slip;
    expect(line(ashaSlip().deductions, 'LWF')).toBe(25);
    expect(line(ashaSlip().employerContributions, 'LWF_ER')).toBe(75);
    expect(line(ashaSlip().deductions, 'PT')).toBe(200);
    expect(ashaSlip().warnings.some((w) => w.includes('accepted proofs'))).toBe(false);
    const declaredTds = line(ashaSlip().deductions, 'TDS') ?? 0;

    // With the cut-off at June, only the ₹80,000 accepted counts and the rejected rent doesn't: more tax.
    await ctx.http().put(`${API}/payroll/settings`).set(pm.h).send({ proofsFromMonth: 6 });
    await ctx.http().post(`${API}/payroll/runs/${run.id}/calculate`).set(pm.h).send({});
    slip = await load();
    expect(ashaSlip().warnings.some((w) => w.includes('accepted proofs only'))).toBe(true);
    expect(line(ashaSlip().deductions, 'TDS')!).toBeGreaterThan(declaredTds);

    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/esi-return`).set(pm.h)).status).toBe(409);
    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(pm.h).send({});
    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(finance.h).send({})).status).toBe(201);

    const esi = await ctx.http().get(`${API}/payroll/runs/${run.id}/esi-return`).set(pm.h);
    expect(esi.status).toBe(200);
    expect(esi.text).toContain('3100123456');
    expect(esi.text).not.toContain('ASHA');
    const levies = await ctx.http().get(`${API}/payroll/runs/${run.id}/state-levies`).set(pm.h);
    expect(levies.text).toMatch(/MH,200,MH,25,75/);
    const summary = (await ctx.http().get(`${API}/payroll/runs/${run.id}/statutory-summary`).set(pm.h)).body.data;
    expect(summary).toMatchObject({ professionalTax: [{ state: 'MH', total: 200 }], labourWelfare: { employee: [{ state: 'MH', total: 25 }], employer: 75 }, esi: { members: 1 } });

    // 24Q and others' Form 16 show PANs: a fresh step-up first.
    expect((await ctx.http().get(`${API}/payroll/statutory/24q?fy=2026&quarter=Q1`).set(pm.h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/auth/step-up`).set(pm.h).send({ password: PASSWORD })).status).toBe(200);
    const q1 = await ctx.http().get(`${API}/payroll/statutory/24q?fy=2026&quarter=Q1`).set(pm.h);
    expect(q1.status).toBe(200);
    expect(q1.text).toContain('ABCDE1234F');
    expect(q1.text).toContain('June 2026');
    const hrForm16 = await ctx.http().get(`${API}/payroll/employees/${asha.employee.id}/form16/document?fy=2026`).set(pm.h);
    expect(hrForm16.status).toBe(200);
    expect(hrForm16.headers['content-type']).toMatch(/text\/html/);

    const form16 = (await ctx.http().get(`${API}/payroll/me/form16?fy=2026`).set(asha.h)).body.data;
    expect(form16).toMatchObject({ financialYear: 2026, regime: 'OLD', employee: { pan: '••••••234F' }, deductions: { section80c: expect.any(Number) } });
    expect(form16.tdsDeducted).toBe(line(ashaSlip().deductions, 'TDS'));
    expect(form16.quarters[0]).toMatchObject({ quarter: expect.stringContaining('Q1'), tds: form16.tdsDeducted });
    const doc = await ctx.http().get(`${API}/payroll/me/form16/document?fy=2026`).set(asha.h);
    expect(doc.text).toContain('Form No. 16');
    expect(doc.text).toContain('ABCDE1234F');
    expect((await ctx.http().get(`${API}/payroll/me/form16?fy=2025`).set(asha.h)).body.data).toBeNull();

    const twelveBB = await ctx.http().get(`${API}/payroll/me/form12bb?fy=2026`).set(asha.h);
    expect(twelveBB.text).toContain('Form No. 12BB');
    expect(twelveBB.text).toContain('PPF deposit, SBI');
    expect(twelveBB.text).toContain('PAN of the landlord');
    expect(twelveBB.text).toContain('₹80,000.00 accepted');
  });
});
