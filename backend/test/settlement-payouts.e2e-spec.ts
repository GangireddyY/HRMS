import { randomUUID } from 'node:crypto';
import { API, PASSWORD, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays as days, resetDatabase, uniqueEmail } from './helpers';

describe('Settlement payouts (e2e)', () => {
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

  /** Two people who resigned, each with an approved settlement; only Asha has bank details. */
  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema');
    const pm = await person(org.organization.id, h, ['payroll_manager'], 'Priya');
    const fin = await person(org.organization.id, h, ['finance_manager'], 'Farah');
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { noticePeriodDays: 0 });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { noticePeriodDays: 0 });
    expect((await ctx.http().put(`${API}/employees/${asha.employee.id}/sensitive`).set(h).send({ bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' })).status).toBe(200);
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    const settlementOf = async (p: typeof asha, bonus: number) => {
      expect((await ctx.http().post(`${API}/payroll/employees/${p.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 600000, effectiveFrom: '2024-01-08' })).status).toBe(201);
      const exit = (await ctx.http().post(`${API}/exits/resign`).set(p.h).send({ reason: 'PERSONAL' })).body.data;
      expect((await ctx.http().post(`${API}/exits/${exit.id}/approve`).set(hr.h).send({ lastWorkingDay: days(0) })).status).toBe(201);
      const calc = await ctx.http().post(`${API}/exits/${exit.id}/settlement`).set(pm.h).send({ adjustments: [{ label: 'Retention bonus', kind: 'EARNING', amount: bonus }] });
      expect(calc.status).toBe(201);
      await ctx.http().post(`${API}/exits/${exit.id}/settlement/submit`).set(pm.h).send({});
      const approved = await ctx.http().post(`${API}/exits/${exit.id}/settlement/approve`).set(fin.h).send({});
      expect(approved.body.data.status).toBe('APPROVED');
      return { caseId: exit.id as string, id: approved.body.data.id as string, net: approved.body.data.netPayable as number };
    };
    return { org, h, hr, pm, fin, asha, ben, a: await settlementOf(asha, 50000), b: await settlementOf(ben, 20000) };
  }

  it('exports a bank file for approved settlements and marks them paid in bulk', async () => {
    const s = await setup();
    const base = `${API}/exits/settlements`;

    // Waiting to be paid: both, one without bank details.
    expect((await ctx.http().get(`${base}/payouts`).set(s.hr.h)).status).toBe(403);
    const waiting = (await ctx.http().get(`${base}/payouts`).set(s.fin.h)).body.data;
    expect(waiting.summary).toMatchObject({ count: 2, withoutBank: 1, total: s.a.net + s.b.net });
    expect(waiting.items.find((i: { id: string }) => i.id === s.a.id)).toMatchObject({ employee: { name: 'Asha Person' }, netPayable: s.a.net, bank: { ifsc: 'HDFC0001234', name: 'HDFC Bank' } });
    expect(waiting.items.find((i: { id: string }) => i.id === s.b.id).bank).toBeNull();

    // The file needs disbursal rights and a fresh step-up; people without bank details are skipped.
    expect((await ctx.http().get(`${base}/bank-file`).set(s.pm.h)).status).toBe(403);
    const unconfirmed = await ctx.http().get(`${base}/bank-file`).set(s.fin.h);
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body.error.code).toBe('STEP_UP_REQUIRED');
    expect((await ctx.http().post(`${API}/auth/step-up`).set(s.fin.h).send({ password: PASSWORD })).status).toBe(200);
    const file = await ctx.http().get(`${base}/bank-file`).set(s.fin.h);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/settlement-payouts-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = file.text.split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`123456789012,HDFC0001234,HDFC Bank,${s.a.net.toFixed(2)},FULL AND FINAL SETTLEMENT`);
    const hdfc = await ctx.http().get(`${base}/bank-file?format=HDFC&ids=${s.a.id}`).set(s.fin.h);
    expect(hdfc.text.split('\r\n')[1]).toMatch(/^I,/);
    expect((await ctx.http().get(`${base}/bank-file?ids=${s.b.id}`).set(s.fin.h)).status).toBe(409);
    expect((await ctx.http().get(`${base}/bank-file?ids=not-a-uuid`).set(s.fin.h)).status).toBe(422);

    // Mark paid in bulk with the batch reference; unknown ids are reported back.
    const missing = randomUUID();
    expect((await ctx.http().post(`${base}/pay`).set(s.fin.h).send({ ids: [s.a.id], paidOn: days(1), reference: 'BATCH-1' })).body.data).toMatchObject({ paid: 0, failed: [{ id: s.a.id }] });
    const paid = (await ctx.http().post(`${base}/pay`).set(s.fin.h).send({ ids: [s.a.id, s.b.id, missing], paidOn: days(0), reference: 'BATCH-1' })).body.data;
    expect(paid).toEqual({ paid: 2, failed: [{ id: missing, reason: 'Settlement not found' }] });
    expect((await ctx.http().get(`${base}/payouts`).set(s.fin.h)).body.data.items).toHaveLength(0);
    const done = (await ctx.http().get(`${base}/payouts?status=PAID`).set(s.fin.h)).body.data.items as { paymentReference: string; paidOn: string }[];
    expect(done).toHaveLength(2);
    expect(done.every((d) => d.paymentReference === 'BATCH-1' && d.paidOn === days(0))).toBe(true);
    expect((await ctx.http().post(`${base}/pay`).set(s.fin.h).send({ ids: [s.a.id], paidOn: days(0), reference: 'BATCH-2' })).body.data.failed[0].reason).toMatch(/Only an approved settlement/);
    const notes = ((await ctx.http().get(`${API}/notifications`).set(s.asha.h)).body.data as { title: string }[]).map((n) => n.title);
    expect(notes).toContain('Your full & final settlement has been paid');
    expect((await ctx.http().get(`${API}/exits/${s.a.caseId}/settlement`).set(s.asha.h)).body.data).toMatchObject({ status: 'PAID', paymentReference: 'BATCH-1' });
  });
});
