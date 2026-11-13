import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

type JournalLine = { ledger: string; debit: number; credit: number; costCentres: { name: string; amount: number }[] };

describe('Payroll accounting: ledger mapping, journal and Tally export (e2e)', () => {
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
      const res = await ctx
        .http()
        .post(`${API}/employees`)
        .set(h)
        .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const pm = await person(['payroll_manager']);
    const fin = await person(['finance_manager']);
    const plain = await person(['employee']);
    return { ...org, h, person, pm, fin, plain };
  }

  it('maps ledgers, builds a balanced journal of an approved run and exports it for Tally', async () => {
    const s = await setup();
    const sales = (await ctx.http().post(`${API}/departments`).set(s.h).send({ name: 'Sales & Marketing' })).body.data;
    const asha = await s.person(['employee'], { departmentId: sales.id });
    const ravi = await s.person(['employee']);
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(s.h).send({})).body.data.structures.find((x: { name: string }) => x.name === 'Standard');
    for (const [e, ctc] of [
      [asha, 600000],
      [ravi, 900000],
    ] as const)
      expect(
        (await ctx.http().post(`${API}/payroll/employees/${e.employee.id}/salaries`).set(s.pm.h).send({ structureId: structure.id, annualCtc: ctc, effectiveFrom: '2026-04-01', reason: 'Joining' }))
          .status,
      ).toBe(201);

    // Defaults until configured; payroll viewers read them, only payroll.configure (payroll manager, admin) changes them.
    const defaults = await ctx.http().get(`${API}/payroll/accounting`).set(s.pm.h);
    expect(defaults.status).toBe(200);
    expect(defaults.body.data).toMatchObject({ tallyCompany: null, voucherType: 'Journal', costCentres: false, ledgers: { SALARY_PAYABLE: 'Salary Payable', PF_PAYABLE: 'PF Payable' } });
    expect((await ctx.http().get(`${API}/payroll/accounting`).set(s.plain.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/payroll/accounting`).set(s.fin.h)).status).toBe(200);
    expect((await ctx.http().put(`${API}/payroll/accounting`).set(s.fin.h).send({ costCentres: true })).status).toBe(403);
    expect(
      (
        await ctx
          .http()
          .put(`${API}/payroll/accounting`)
          .set(s.h)
          .send({ earningLedgers: [{ code: 'NOPE', name: 'X' }] })
      ).status,
    ).toBe(422);
    expect(
      (
        await ctx
          .http()
          .put(`${API}/payroll/accounting`)
          .set(s.h)
          .send({ ledgers: [{ slot: 'PF_PAYABLE', name: 'Bad <name>' }] })
      ).status,
    ).toBe(422);
    const saved = await ctx
      .http()
      .put(`${API}/payroll/accounting`)
      .set(s.h)
      .send({
        tallyCompany: 'Acme Pvt Ltd',
        costCentres: true,
        ledgers: [{ slot: 'SALARY_PAYABLE', name: 'Salaries Payable A/c' }],
        earningLedgers: [{ code: 'HRA', name: 'House Rent Allowance' }],
      });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      tallyCompany: 'Acme Pvt Ltd',
      costCentres: true,
      ledgers: { SALARY_PAYABLE: 'Salaries Payable A/c', PF_PAYABLE: 'PF Payable' },
      earningLedgers: { HRA: 'House Rent Allowance' },
    });

    const run = (await ctx.http().post(`${API}/payroll/runs`).set(s.pm.h).send({ year: 2026, month: 10 })).body.data;
    // Not before approval.
    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/journal`).set(s.pm.h)).status).toBe(409);
    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(s.pm.h).send({});
    expect((await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(s.fin.h).send({})).status).toBe(201);

    const journal = await ctx.http().get(`${API}/payroll/runs/${run.id}/journal`).set(s.pm.h);
    expect(journal.status).toBe(200);
    const j = journal.body.data as { date: string; currency: string; lines: JournalLine[]; totalDebit: number; totalCredit: number; narration: string; payslips: number };
    expect(j).toMatchObject({ date: '2026-10-31', currency: 'INR' });
    expect(j.totalDebit).toBeGreaterThan(0);
    expect(j.totalDebit).toBe(j.totalCredit);
    const slips = (await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(s.pm.h)).body.data as { netPay: number | string }[];
    const net = slips.reduce((n, p) => n + Number(p.netPay), 0);
    expect(j.lines.find((l) => l.ledger === 'Salaries Payable A/c')!.credit).toBeCloseTo(net, 2);
    const hra = j.lines.find((l) => l.ledger === 'House Rent Allowance')!;
    expect(hra.debit).toBeGreaterThan(0);
    expect(hra.costCentres.map((c) => c.name).sort()).toEqual(['Sales & Marketing', 'Unassigned']);
    expect(hra.costCentres.reduce((n, c) => n + c.amount, 0)).toBeCloseTo(hra.debit, 2);
    expect(j.payslips).toBe(slips.length);

    const xml = await ctx.http().get(`${API}/payroll/runs/${run.id}/tally`).set(s.pm.h);
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toContain('application/xml');
    expect(xml.headers['content-disposition']).toContain('tally-journal-2026-10.xml');
    expect(xml.text).toContain('<SVCURRENTCOMPANY>Acme Pvt Ltd</SVCURRENTCOMPANY>');
    expect(xml.text).toContain(`<VOUCHER REMOTEID="hrms-payroll-${run.id}" VCHTYPE="Journal" ACTION="Create"><DATE>20261031</DATE>`);
    expect(xml.text).toContain('<NAME>Sales &amp; Marketing</NAME>');
    const amounts = [...xml.text.matchAll(/<ALLLEDGERENTRIES\.LIST><LEDGERNAME>[^<]+<\/LEDGERNAME><ISDEEMEDPOSITIVE>(?:Yes|No)<\/ISDEEMEDPOSITIVE><AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) =>
      Math.round(Number(m[1]) * 100),
    );
    expect(amounts.length).toBe(j.lines.length);
    expect(amounts.reduce((n, a) => n + a, 0)).toBe(0);

    const masters = await ctx.http().get(`${API}/payroll/runs/${run.id}/tally?part=masters`).set(s.pm.h);
    expect(masters.status).toBe(200);
    expect(masters.text).toContain('<LEDGER NAME="PF Payable" ACTION="Create"><NAME.LIST><NAME>PF Payable</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT></LEDGER>');
    expect(masters.text).toContain('<COSTCENTRE NAME="Sales &amp; Marketing" ACTION="Create">');
    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/tally?part=nope`).set(s.pm.h)).status).toBe(422);
    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/tally`).set(s.plain.h)).status).toBe(403);

    const audit = await ctx.http().get(`${API}/audit-logs?action=payroll.tally_exported`).set(s.h);
    expect(audit.body.data.length).toBe(2);
  });

  it('keeps each organization to its own settings and runs', async () => {
    const a = await setup();
    const b = await setup();
    await ctx.http().put(`${API}/payroll/accounting`).set(a.h).send({ tallyCompany: 'Company A' });
    expect((await ctx.http().get(`${API}/payroll/accounting`).set(b.h)).body.data.tallyCompany).toBeNull();
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(a.pm.h).send({ year: 2026, month: 10 })).body.data;
    expect((await ctx.http().get(`${API}/payroll/runs/${run.id}/journal`).set(b.pm.h)).status).toBe(404);
  });
});
