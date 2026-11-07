import { Notification, PolicyAcknowledgement, PolicyVersion } from '../src/database/models';
import { addMonths } from '../src/common/utils/zoned-time';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays as days, orgToday, resetDatabase, uniqueEmail } from './helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const months = (n: number) => addMonths(orgToday(), n);

describe('Compliance (e2e)', () => {
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
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    const ops = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Operations' })).body.data;
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema', { departmentId: ops.id });
    const exec = await person(org.organization.id, h, ['hr_executive'], 'Ezra', { departmentId: ops.id });
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { departmentId: eng.id });
    const chen = await person(org.organization.id, h, ['employee'], 'Chen', { departmentId: ops.id });
    return { org, h, eng, ops, hr, exec, asha, chen };
  }

  it('publishes versioned policies, tracks acknowledgements and asks again only for material changes', async () => {
    const t = await team();
    const created = await ctx.http().post(`${API}/compliance/policies`).set(t.hr.h).send({ title: 'Code of conduct', category: 'CODE_OF_CONDUCT', summary: 'How we work together', ackDueDays: 14, reviewMonths: 12, content: 'Treat everyone with respect.' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ status: 'DRAFT', hasDraft: true, currentVersion: null });
    expect((await ctx.http().post(`${API}/compliance/policies`).set(t.asha.h).send({ title: 'Mine', category: 'HR' })).status).toBe(403);
    expect((await ctx.http().get(`${API}/compliance/policies/mine`).set(t.asha.h)).body.data).toEqual([]);
    // HR views need compliance.manage (employees and the HR executive only see policies that apply to them).
    expect((await ctx.http().get(`${API}/compliance/policies`).set(t.exec.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/compliance/policies`).set(t.asha.h)).status).toBe(403);

    const empty = (await ctx.http().post(`${API}/compliance/policies`).set(t.hr.h).send({ title: 'Travel', category: 'TRAVEL' })).body.data;
    expect((await ctx.http().post(`${API}/compliance/policies/${empty.id}/publish`).set(t.hr.h).send({})).status).toBe(422);

    const published = await ctx.http().post(`${API}/compliance/policies/${id}/publish`).set(t.hr.h).send({});
    expect(published.body.data).toMatchObject({ status: 'PUBLISHED', currentVersion: { version: 1, publishedOn: days(0) }, nextReviewOn: months(12), stats: { audience: 4, acknowledged: 0, pending: 4, overdue: 0 } });
    expect(await Notification.count({ where: { userId: t.asha.user.id, link: `/me/policies/${id}` }, ...RAW })).toBe(1);

    // Employees read and acknowledge the current version; the record keeps the IP address and browser.
    const mine = (await ctx.http().get(`${API}/compliance/policies/mine`).set(t.asha.h)).body.data;
    expect(mine).toEqual([expect.objectContaining({ id, state: 'PENDING', dueOn: days(14), version: expect.objectContaining({ version: 1 }) })]);
    const read = (await ctx.http().get(`${API}/compliance/policies/${id}/read`).set(t.asha.h)).body.data;
    expect(read).toMatchObject({ canAcknowledge: true, version: { content: 'Treat everyone with respect.' } });
    expect((await ctx.http().post(`${API}/compliance/policies/${id}/acknowledge`).set(t.asha.h).send({ versionId: empty.id })).status).toBe(409);
    const acked = await ctx.http().post(`${API}/compliance/policies/${id}/acknowledge`).set(t.asha.h).set('User-Agent', 'e2e-browser').send({ versionId: read.version.id });
    expect(acked.body.data).toMatchObject({ canAcknowledge: false, mine: { state: 'ACKNOWLEDGED', acknowledgedVersion: 1 } });
    expect((await ctx.http().post(`${API}/compliance/policies/${id}/acknowledge`).set(t.asha.h).send({ versionId: read.version.id })).status).toBe(409);
    const evidence = await PolicyAcknowledgement.findOne({ where: { policyId: id }, ...RAW });
    expect(evidence).toMatchObject({ userAgent: 'e2e-browser', ipAddress: expect.any(String) });

    // HR tracking and reminders at most once a day.
    const tracking = (await ctx.http().get(`${API}/compliance/policies/${id}/acknowledgements`).set(t.hr.h)).body.data;
    expect(tracking.counts).toEqual({ audience: 4, acknowledged: 1, pending: 3, overdue: 0 });
    expect(tracking.items.at(-1)).toMatchObject({ employee: { name: 'Asha Person' }, state: 'ACKNOWLEDGED' });
    for (const h of [t.asha.h, t.exec.h]) expect((await ctx.http().get(`${API}/compliance/policies/${id}/acknowledgements`).set(h)).status).toBe(403);
    expect((await ctx.http().post(`${API}/compliance/policies/${id}/remind`).set(t.hr.h).send({})).body.data).toEqual({ reminded: 3, withoutLogin: 0 });
    expect((await ctx.http().post(`${API}/compliance/policies/${id}/remind`).set(t.hr.h).send({})).status).toBe(409);
    const csv = await ctx.http().get(`${API}/compliance/policies/${id}/acknowledgements.csv`).set(t.hr.h);
    expect(csv.text.replace(/^\uFEFF/, '').trim().split('\r\n')).toHaveLength(5);

    // A minor update keeps acknowledgements; a material one asks everyone again.
    await ctx.http().put(`${API}/compliance/policies/${id}/draft`).set(t.hr.h).send({ content: 'Treat everyone with respect. Typo fixed.', changeSummary: 'Typo fixed', reacknowledge: false });
    const v2 = await ctx.http().post(`${API}/compliance/policies/${id}/publish`).set(t.hr.h).send({});
    expect(v2.body.data.currentVersion.version).toBe(2);
    expect(v2.body.data.versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[2, 'PUBLISHED'], [1, 'SUPERSEDED']]);
    expect((await ctx.http().get(`${API}/compliance/policies/mine`).set(t.asha.h)).body.data[0]).toMatchObject({ state: 'ACKNOWLEDGED', acknowledgedVersion: 1 });
    await ctx.http().put(`${API}/compliance/policies/${id}/draft`).set(t.hr.h).send({ content: 'New rules on gifts from vendors.', changeSummary: 'Gifts section added', reacknowledge: true });
    await ctx.http().post(`${API}/compliance/policies/${id}/publish`).set(t.hr.h).send({});
    const again = (await ctx.http().get(`${API}/compliance/policies/${id}/read`).set(t.asha.h)).body.data;
    expect(again).toMatchObject({ canAcknowledge: true, mine: { state: 'PENDING' }, version: { version: 3, changeSummary: 'Gifts section added' } });
    await ctx.http().post(`${API}/compliance/policies/${id}/acknowledge`).set(t.asha.h).send({ versionId: again.version.id });

    // Deadlines pass: overdue (simulated by moving the publication date back).
    await PolicyVersion.update({ publishedOn: days(-30) }, { where: { id: again.version.id }, ...RAW });
    const late = (await ctx.http().get(`${API}/compliance/policies/${id}/acknowledgements?state=OVERDUE`).set(t.hr.h)).body.data;
    expect(late.counts).toMatchObject({ acknowledged: 1, overdue: 3 });
    expect(late.items.map((s: { employee: { name: string } }) => s.employee.name)).not.toContain('Asha Person');

    // Targeted policy with a PDF.
    const it = (await ctx.http().post(`${API}/compliance/policies`).set(t.hr.h).send({ title: 'Secure coding', category: 'IT_SECURITY', departmentIds: [t.eng.id] })).body.data;
    expect((await ctx.http().post(`${API}/compliance/policies/${it.id}/draft/file`).set(t.hr.h).attach('file', Buffer.from('plain text'), 'rules.pdf')).status).toBe(422);
    const withFile = await ctx.http().post(`${API}/compliance/policies/${it.id}/draft/file`).set(t.hr.h).attach('file', PDF, 'secure-coding.pdf');
    expect(withFile.body.data.versions[0].file).toEqual({ name: 'secure-coding.pdf', size: PDF.length });
    await ctx.http().post(`${API}/compliance/policies/${it.id}/publish`).set(t.hr.h).send({});
    expect((await ctx.http().get(`${API}/compliance/policies/mine`).set(t.chen.h)).body.data.map((p: { id: string }) => p.id)).toEqual([id]);
    expect((await ctx.http().get(`${API}/compliance/policies/${it.id}/read`).set(t.chen.h)).status).toBe(404);
    const versionId = (await ctx.http().get(`${API}/compliance/policies/${it.id}/read`).set(t.asha.h)).body.data.version.id;
    const pdf = await ctx.http().get(`${API}/compliance/policies/${it.id}/versions/${versionId}/file`).set(t.asha.h);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await ctx.http().get(`${API}/compliance/policies/${it.id}/versions/${versionId}/file`).set(t.chen.h)).status).toBe(404);

    // Reviews, retirement and deletion.
    expect((await ctx.http().post(`${API}/compliance/policies/${it.id}/reviewed`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/compliance/policies/${id}/reviewed`).set(t.hr.h).send({})).body.data.nextReviewOn).toBe(months(12));
    expect((await ctx.http().delete(`${API}/compliance/policies/${it.id}`).set(t.hr.h)).status).toBe(409);
    await ctx.http().post(`${API}/compliance/policies/${it.id}/retire`).set(t.hr.h).send({});
    expect((await ctx.http().get(`${API}/compliance/policies/${it.id}/read`).set(t.asha.h)).status).toBe(404);
    expect((await ctx.http().delete(`${API}/compliance/policies/${empty.id}`).set(t.hr.h)).body.data).toEqual({ deleted: true });

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/compliance/policies/${id}`).set(oh)).status).toBe(404);
  });

  it('keeps a statutory calendar with filings and overdue due dates', async () => {
    const t = await team();
    expect((await ctx.http().post(`${API}/compliance/obligations/recommended`).set(t.hr.h).send({})).body.data).toEqual({ added: 7 });
    expect((await ctx.http().post(`${API}/compliance/obligations/recommended`).set(t.hr.h).send({})).body.data).toEqual({ added: 0 });
    expect((await ctx.http().get(`${API}/compliance/obligations`).set(t.hr.h)).body.data).toHaveLength(7);
    expect((await ctx.http().post(`${API}/compliance/obligations`).set(t.exec.h).send({ title: 'X', category: 'OTHER', dueDates: ['01-01'], startsOn: days(0) })).status).toBe(403);
    for (const h of [t.asha.h, t.exec.h]) expect((await ctx.http().get(`${API}/compliance/calendar?from=${days(0)}&to=${days(30)}`).set(h)).status).toBe(403);

    const bad = await ctx.http().post(`${API}/compliance/obligations`).set(t.hr.h).send({ title: 'Shops licence', category: 'LABOUR', dueDates: ['13-01'], startsOn: days(-60) });
    expect(bad.status).toBe(422);
    const dueOn = days(-10);
    const licence = (await ctx.http().post(`${API}/compliance/obligations`).set(t.hr.h).send({ title: 'Shops licence renewal', category: 'LABOUR', authority: 'Labour department', dueDates: [dueOn.slice(5)], startsOn: days(-60), ownerUserId: t.hr.user.id })).body.data;
    expect(licence.owner).toEqual({ id: t.hr.user.id, name: 'Hema Person' });

    const cal = (await ctx.http().get(`${API}/compliance/calendar?from=${days(0)}&to=${days(62)}&overdue=true`).set(t.hr.h)).body.data;
    expect(cal.items[0]).toMatchObject({ obligation: { title: 'Shops licence renewal' }, dueOn, state: 'OVERDUE', filing: null });
    expect(cal.counts.overdue).toBe(1);
    expect(cal.items.filter((i: { obligation: { title: string } }) => i.obligation.title === 'PF contributions and ECR').every((i: { dueOn: string }) => i.dueOn.endsWith('-15'))).toBe(true);
    expect(cal.items.some((i: { obligation: { title: string } }) => i.obligation.title === 'PF contributions and ECR')).toBe(true);

    // Filing a due date (with the receipt); only real due dates, not in the future, once.
    const filingUrl = `${API}/compliance/obligations/${licence.id}/filings`;
    expect((await ctx.http().post(filingUrl).set(t.hr.h).field('dueOn', days(-11)).field('completedOn', days(0))).status).toBe(422);
    expect((await ctx.http().post(filingUrl).set(t.hr.h).field('dueOn', dueOn).field('completedOn', days(1))).status).toBe(422);
    const filed = await ctx.http().post(filingUrl).set(t.hr.h).field('dueOn', dueOn).field('completedOn', days(0)).field('reference', 'SE/2026/0042').attach('file', PDF, 'receipt.pdf');
    expect(filed.status).toBe(201);
    expect((await ctx.http().post(filingUrl).set(t.hr.h).field('dueOn', dueOn).field('completedOn', days(0))).status).toBe(409);
    const after = (await ctx.http().get(`${API}/compliance/calendar?from=${days(-30)}&to=${days(0)}`).set(t.hr.h)).body.data;
    const item = after.items.find((i: { obligation: { id: string } }) => i.obligation.id === licence.id);
    expect(item).toMatchObject({ state: 'DONE', filing: { reference: 'SE/2026/0042', late: true, completedBy: 'Hema Person', file: { name: 'receipt.pdf' } } });
    const receipt = await ctx.http().get(`${API}/compliance/filings/${item.filing.id}/file`).set(t.hr.h);
    expect(receipt.status).toBe(200);
    expect((await ctx.http().get(`${API}/compliance/filings/${item.filing.id}/file`).set(t.exec.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/compliance/calendar?from=${days(0)}&to=${days(62)}&overdue=true`).set(t.hr.h)).body.data.counts.overdue).toBe(0);

    // Obligations with filings are deactivated, not deleted.
    expect((await ctx.http().delete(`${API}/compliance/obligations/${licence.id}`).set(t.hr.h)).status).toBe(409);
    await ctx.http().delete(`${API}/compliance/filings/${item.filing.id}`).set(t.hr.h);
    expect((await ctx.http().delete(`${API}/compliance/obligations/${licence.id}`).set(t.hr.h)).status).toBe(200);
  });
});
