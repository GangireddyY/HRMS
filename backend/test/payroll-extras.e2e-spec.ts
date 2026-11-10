import { API, PASSWORD, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

type Line = { code: string; name: string; amount: number; rate?: number };
type Slip = { id: string; employeeId: string; earnings?: Line[]; warnings?: string[] };

describe('Payroll extras: arrears, pay groups, bonuses, bank layouts and PDF payslips (e2e)', () => {
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
    const pm = await person(['payroll_manager']);
    const fin = await person(['finance_manager']);
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    const salary = (employeeId: string, annualCtc: number, effectiveFrom: string) => ctx.http().post(`${API}/payroll/employees/${employeeId}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc, effectiveFrom, reason: 'Revision' });
    const slips = async (runId: string) => (await ctx.http().get(`${API}/payroll/runs/${runId}/payslips`).set(pm.h)).body.data as Slip[];
    const slip = async (id: string) => (await ctx.http().get(`${API}/payroll/payslips/${id}`).set(pm.h)).body.data as Slip & { earnings: Line[] };
    async function runAndApprove(month: number, payGroupId?: string) {
      const run = (await ctx.http().post(`${API}/payroll/runs`).set(pm.h).send({ year: 2026, month, payGroupId })).body.data;
      expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(pm.h).send({})).status).toBe(201);
      expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(fin.h).send({})).status).toBe(201);
      return run as { id: string };
    }
    return { ...org, h, person, pm, fin, salary, slips, slip, runAndApprove };
  }

  it('pays arrears for a revision back-dated into months already paid, once', async () => {
    const s = await setup();
    const asha = await s.person(['employee']);
    expect((await s.salary(asha.employee.id, 600000, '2026-04-01')).status).toBe(201);
    const aug = await s.runAndApprove(8);
    const sep = await s.runAndApprove(9);
    const paid = async (runId: string) => (await s.slip((await s.slips(runId)).find((p) => p.employeeId === asha.employee.id)!.id)).earnings.filter((l) => l.rate !== undefined);
    const augPaid = await paid(aug.id);
    const sepPaid = await paid(sep.id);

    // A raise from 1 August, recorded after August and September were paid.
    expect((await s.salary(asha.employee.id, 720000, '2025-01-01')).status).toBe(422);
    expect((await s.salary(asha.employee.id, 720000, '2026-08-01')).status).toBe(201);
    const oct = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).body.data;
    const octSlip = await s.slip((await s.slips(oct.id)).find((p) => p.employeeId === asha.employee.id)!.id);
    const newMonthly = octSlip.earnings.filter((l) => l.rate !== undefined).reduce((t, l) => t + l.rate!, 0);
    const sum = (lines: Line[]) => lines.reduce((t, l) => t + l.amount, 0);
    const expected = Math.round(2 * newMonthly - sum(augPaid) - sum(sepPaid));
    expect(octSlip.earnings.find((l) => l.code === 'ARREARS')).toMatchObject({ name: 'Salary arrears (Aug – September 2026)', amount: expected });
    expect(octSlip.warnings!.some((w) => w.startsWith('Arrears of'))).toBe(true);
    await ctx.http().post(`${API}/payroll/runs/${oct.id}/submit`).set(s.pm.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${oct.id}/approve`).set(s.fin.h).send({});

    // Paid once: the next run has none.
    const nov = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 11 })).body.data;
    const novSlip = await s.slip((await s.slips(nov.id)).find((p) => p.employeeId === asha.employee.id)!.id);
    expect(novSlip.earnings.find((l) => l.code === 'ARREARS')).toBeUndefined();
  });

  it('runs pay groups separately and never pays anyone twice for a month', async () => {
    const s = await setup();
    const staff = await s.person(['employee']);
    const contractor = await s.person(['employee']);
    for (const e of [staff, contractor]) await s.salary(e.employee.id, 480000, '2026-04-01');
    const group = await ctx.http().post(`${API}/payroll/pay-groups`).set(s.h).send({ name: 'Contractors', description: 'Paid on the 5th' });
    expect(group.status).toBe(201);
    expect((await ctx.http().post(`${API}/payroll/pay-groups`).set(s.h).send({ name: 'contractors' })).status).toBe(422);
    expect((await ctx.http().put(`${API}/payroll/pay-groups/members`).set(s.h).send({ employeeIds: [contractor.employee.id], payGroupId: group.body.data.id })).body.data.groups[0]).toMatchObject({ name: 'Contractors', employees: 1 });

    const main = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).body.data;
    expect(main.payGroup).toBeNull();
    expect((await s.slips(main.id)).map((p) => p.employeeId)).not.toContain(contractor.employee.id);
    // Moving someone while their run is in progress is refused.
    expect((await ctx.http().put(`${API}/payroll/pay-groups/members`).set(s.h).send({ employeeIds: [staff.employee.id], payGroupId: group.body.data.id })).status).toBe(409);
    const theirs = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10, payGroupId: group.body.data.id })).body.data;
    expect(theirs.payGroup).toMatchObject({ name: 'Contractors' });
    expect((await s.slips(theirs.id)).map((p) => p.employeeId)).toEqual([contractor.employee.id]);
    expect((await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10, payGroupId: group.body.data.id })).status).toBe(409);
    expect((await ctx.http().delete(`${API}/payroll/pay-groups/${group.body.data.id}`).set(s.h)).status).toBe(409);
  });

  it('adds bonuses in bulk, exports bank layouts and serves payslip PDFs', async () => {
    const s = await setup();
    const asha = await s.person(['employee']);
    const ravi = await s.person(['employee']);
    await s.salary(asha.employee.id, 300000, '2026-04-01');
    await s.salary(ravi.employee.id, 1800000, '2026-04-01');
    for (const e of [asha, ravi]) {
      await ctx.http().put(`${API}/employees/${e.employee.id}/sensitive`).set(s.h).send({ bankAccountNumber: e === asha ? '111122223333' : '444455556666', bankIfsc: e === asha ? 'HDFC0001234' : 'ICIC0004321', bankName: e === asha ? 'HDFC Bank' : 'ICICI Bank' });
    }
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).body.data;
    const bonus = await ctx.http().post(`${API}/payroll/runs/${run.id}/bonuses`).set(s.pm.h).send({ label: 'Diwali bonus', category: 'BONUS', basis: 'PERCENT_OF_BASIC', value: 10 });
    expect(bonus.status).toBe(201);
    expect(bonus.body.data).toMatchObject({ added: 2, skipped: [] });
    const statutory = await ctx.http().post(`${API}/payroll/runs/${run.id}/bonuses`).set(s.pm.h).send({ label: 'Statutory bonus', category: 'BONUS', basis: 'STATUTORY', value: 8.33 });
    expect(statutory.body.data).toMatchObject({ added: 1, skipped: [expect.objectContaining({ reason: expect.stringContaining('Basic above') })] });
    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/bonuses`).set(s.pm.h).send({ label: 'Too much', category: 'BONUS', basis: 'STATUTORY', value: 30 })).status).toBe(422);

    const ashaSlip = await s.slip((await s.slips(run.id)).find((p) => p.employeeId === asha.employee.id)!.id);
    const basic = ashaSlip.earnings.find((l) => l.code === 'BASIC')!.rate!;
    expect(ashaSlip.earnings.find((l) => l.name === 'Diwali bonus')!.amount).toBe(Math.round(basic * 0.1));
    // April–October: 7 months × 8.33% of min(Basic, ₹7,000).
    expect(ashaSlip.earnings.find((l) => l.name === 'Statutory bonus')!.amount).toBe(Math.round(((Math.min(basic, 7000) * 8.33) / 100) * 7));

    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(s.pm.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(s.fin.h).send({});
    await ctx.http().post(`${API}/auth/step-up`).set(s.fin.h).send({ password: PASSWORD });
    const hdfc = await ctx.http().get(`${API}/payroll/runs/${run.id}/bank-file?format=HDFC`).set(s.fin.h);
    expect(hdfc.status).toBe(200);
    const [header, ...rows] = hdfc.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(header).toContain('Transaction Type');
    expect(rows.find((r) => r.includes('111122223333'))!.startsWith('I,')).toBe(true);
    expect(rows.find((r) => r.includes('444455556666'))!.startsWith('N,')).toBe(true);
    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/bank-file?format=NOPE`).set(s.fin.h)).status).toBe(422);

    const pdf = await ctx.http().get(`${API}/payroll/payslips/${ashaSlip.id}/pdf`).set(asha.h).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ctx.http().get(`${API}/payroll/payslips/${ashaSlip.id}/pdf`).set(ravi.h)).status).toBe(404);
  });

  it('emails payslip PDFs on approval when payroll setup turns it on', async () => {
    const s = await setup();
    const asha = await s.person(['employee'], { dateOfBirth: '1992-03-14' });
    await s.salary(asha.employee.id, 480000, '2026-04-01');
    expect((await ctx.http().put(`${API}/payroll/settings`).set(s.pm.h).send({ payslipEmailEnabled: true, payslipPdfPassword: 'DOB' })).body.data).toMatchObject({ payslipEmailEnabled: true });
    const mail = ctx.mail;
    const before = mail.outbox.length;
    await s.runAndApprove(10);
    await new Promise((r) => setTimeout(r, 500));
    const sent = mail.outbox.slice(before).find((m) => m.to === asha.user.email && m.subject === 'Your payslip for October 2026');
    expect(sent).toBeDefined();
    expect(sent!.text).toContain('date of birth');
    expect(sent!.attachments?.[0]).toMatchObject({ filename: 'payslip-2026-10.pdf', type: 'application/pdf' });
    expect(Buffer.from(sent!.attachments![0]!.content, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
});
