import { AuditLog, GrievanceCase, GrievanceNote, Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const DESCRIPTION = 'My manager keeps reassigning my work to others without telling me, in front of the whole team.';

describe('Grievances (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], firstName: string) {
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function role(h: Record<string, string>, name: string, keys: string[]) {
    const res = await ctx.http().post(`${API}/roles`).set(h).send({ name, permissions: keys.map((key) => ({ key, scope: 'ORGANIZATION' })) });
    expect(res.status).toBe(201);
    return res.body.data.key as string;
  }

  async function team() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const officerRole = await role(h, 'Grievance Officer', ['grievance.view']);
    const icRole = await role(h, 'Internal Committee', ['grievance.posh.access']);
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema');
    const officer = await person(org.organization.id, h, ['employee', officerRole], 'Omar');
    const ic = await person(org.organization.id, h, ['employee', icRole], 'Indira');
    const ic2 = await person(org.organization.id, h, ['employee', icRole], 'Ishaan');
    const asha = await person(org.organization.id, h, ['employee'], 'Asha');
    const ben = await person(org.organization.id, h, ['employee'], 'Ben');
    return { org, h, hr, officer, ic, ic2, asha, ben };
  }

  const raise = (t: Awaited<ReturnType<typeof team>>, who: { h: Record<string, string> }, body: Record<string, unknown>) =>
    ctx.http().post(`${API}/grievances`).set(who.h).send({ category: 'MANAGER', subject: 'Work reassigned without notice', description: DESCRIPTION, ...body });

  it('handles a grievance from submission to closure, keeping internal notes from the complainant', async () => {
    const t = await team();
    expect((await raise(t, t.asha, { incidentDate: '2099-01-01' })).status).toBe(422);
    expect((await raise(t, t.asha, { respondentId: t.asha.employee.id })).status).toBe(422);
    const created = await raise(t, t.asha, { respondentId: t.ben.employee.id, incidentDate: daysAgo(5), incidentLocation: 'Floor 3' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data).toMatchObject({ reference: 'GRV-0001', status: 'SUBMITTED', role: 'COMPLAINANT', description: DESCRIPTION, posh: false });
    expect(created.body.data.priority).toBeUndefined();

    // Stored encrypted; audit entries carry only the reference.
    const row = await GrievanceCase.findByPk(id, RAW);
    expect(row!.detailsEncrypted).not.toContain('reassigning');
    // Grievance managers are told about new cases.
    expect(await Notification.count({ where: { userId: t.hr.user.id, link: `/hr/grievances/${id}` }, ...RAW })).toBe(1);

    // The respondent and unrelated employees can't see it; nor can someone with grievance.view until assigned.
    expect((await ctx.http().get(`${API}/grievances/${id}`).set(t.ben.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/grievances`).set(t.ben.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/grievances/${id}`).set(t.officer.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/grievances?view=all`).set(t.officer.h)).status).toBe(403);

    const all = await ctx.http().get(`${API}/grievances?view=all`).set(t.hr.h);
    expect(all.body.data).toEqual([expect.objectContaining({ id, complainant: expect.objectContaining({ name: 'Asha Person' }), respondent: expect.objectContaining({ name: 'Ben Person' }), assignee: null })]);
    const handlers = (await ctx.http().get(`${API}/grievances/${id}/handlers`).set(t.hr.h)).body.data.map((u: { id: string }) => u.id);
    expect(handlers).toEqual(expect.arrayContaining([t.hr.user.id, t.officer.user.id, t.org.admin.id]));
    expect(handlers).not.toContain(t.ic.user.id);
    expect((await ctx.http().post(`${API}/grievances/${id}/assign`).set(t.hr.h).send({ assigneeUserId: t.ic.user.id })).status).toBe(422);

    const assigned = await ctx.http().post(`${API}/grievances/${id}/assign`).set(t.hr.h).send({ assigneeUserId: t.officer.user.id });
    expect(assigned.body.data).toMatchObject({ status: 'IN_REVIEW', assignee: { id: t.officer.user.id, name: 'Omar Person' } });
    expect(await Notification.count({ where: { userId: t.asha.user.id, title: 'Your case GRV-0001 is being reviewed' }, ...RAW })).toBe(1);

    // The assigned officer (grievance.view) sees and annotates the case but can't resolve it.
    const seen = await ctx.http().get(`${API}/grievances/${id}`).set(t.officer.h);
    expect(seen.body.data.permissions).toMatchObject({ manage: false, note: true, resolve: false });
    expect((await ctx.http().get(`${API}/grievances?view=assigned`).set(t.officer.h)).body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await ctx.http().post(`${API}/grievances/${id}/resolve`).set(t.officer.h).send({ outcome: 'UPHELD', summary: 'Spoke to the manager.' })).status).toBe(403);
    await ctx.http().post(`${API}/grievances/${id}/notes`).set(t.officer.h).send({ body: 'Manager has a history of this; check last year.', visibility: 'INTERNAL' });
    await ctx.http().post(`${API}/grievances/${id}/notes`).set(t.officer.h).send({ body: 'Thanks, we are looking into it. Could you share the dates?' });
    await ctx.http().patch(`${API}/grievances/${id}`).set(t.hr.h).send({ priority: 'HIGH' });
    const notes = await GrievanceNote.findAll({ where: { caseId: id }, ...RAW });
    expect(notes.every((n) => !n.bodyEncrypted.includes('Manager'))).toBe(true);

    // The complainant sees shared notes and events only, and no priority.
    const mine = (await ctx.http().get(`${API}/grievances/${id}`).set(t.asha.h)).body.data;
    expect(mine.notes.map((n: { body: string }) => n.body)).toEqual(['Thanks, we are looking into it. Could you share the dates?']);
    expect(mine.events.map((e: { type: string }) => e.type)).toEqual(['SUBMITTED', 'ASSIGNED', 'ACKNOWLEDGED']);
    expect(mine.priority).toBeUndefined();
    const reply = await ctx.http().post(`${API}/grievances/${id}/notes`).set(t.asha.h).send({ body: 'It happened on 3 and 5 November.', visibility: 'INTERNAL' });
    expect(reply.body.data.notes.at(-1)).toMatchObject({ fromComplainant: true, visibility: 'SHARED', author: 'Asha Person' });
    expect(await Notification.count({ where: { userId: t.officer.user.id, title: 'New message from the complainant on GRV-0001' }, ...RAW })).toBe(1);

    // Evidence: type checked from the contents; the handler can open it.
    expect((await ctx.http().post(`${API}/grievances/${id}/attachments`).set(t.asha.h).attach('file', Buffer.from('not a pdf'), 'notes.pdf')).status).toBe(422);
    const uploaded = await ctx.http().post(`${API}/grievances/${id}/attachments`).set(t.asha.h).attach('file', Buffer.from('%PDF-1.4 evidence'), 'chat.pdf');
    expect(uploaded.status).toBe(201);
    const file = uploaded.body.data.attachments[0];
    expect(file).toMatchObject({ fileName: 'chat.pdf', visibility: 'SHARED', fromComplainant: true });
    const download = await ctx.http().get(`${API}/grievances/${id}/attachments/${file.id}`).set(t.officer.h);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    const internalFile = await ctx.http().post(`${API}/grievances/${id}/attachments`).set(t.hr.h).field('visibility', 'INTERNAL').attach('file', Buffer.from('%PDF-1.4 interview'), 'interview.pdf');
    const internalId = internalFile.body.data.attachments.find((a: { visibility: string }) => a.visibility === 'INTERNAL').id;
    expect((await ctx.http().get(`${API}/grievances/${id}/attachments/${internalId}`).set(t.asha.h)).status).toBe(404);

    await ctx.http().post(`${API}/grievances/${id}/investigate`).set(t.hr.h).send({});
    const resolved = await ctx.http().post(`${API}/grievances/${id}/resolve`).set(t.hr.h).send({ outcome: 'PARTIALLY_UPHELD', summary: 'Work allocation will be discussed in 1:1s from now on.', actions: 'Coaching for the manager.' });
    expect(resolved.body.data).toMatchObject({ status: 'RESOLVED', outcome: 'PARTIALLY_UPHELD', resolution: { actions: 'Coaching for the manager.' } });
    const view = (await ctx.http().get(`${API}/grievances/${id}`).set(t.asha.h)).body.data;
    expect(view.resolution).toEqual({ summary: 'Work allocation will be discussed in 1:1s from now on.', resolvedBy: 'Hema Person', resolvedAt: expect.any(String) });
    expect(view.permissions).toMatchObject({ accept: true, reopen: true });

    // Closing waits for the reopening window; the complainant reopens once.
    expect((await ctx.http().post(`${API}/grievances/${id}/close`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/grievances/${id}/reopen`).set(t.asha.h).send({ reason: 'short' })).status).toBe(422);
    const reopened = await ctx.http().post(`${API}/grievances/${id}/reopen`).set(t.asha.h).send({ reason: 'It happened again this week after the decision.' });
    expect(reopened.body.data).toMatchObject({ status: 'IN_REVIEW', reopened: true, outcome: null, resolution: expect.objectContaining({ summary: expect.any(String) }) });
    await ctx.http().post(`${API}/grievances/${id}/resolve`).set(t.hr.h).send({ outcome: 'UPHELD', summary: 'The manager has been moved to another team.' });
    expect((await ctx.http().post(`${API}/grievances/${id}/reopen`).set(t.asha.h).send({ reason: 'Still not happy with this outcome.' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/grievances/${id}/close`).set(t.hr.h).send({})).body.data.status).toBe('CLOSED');
    expect((await ctx.http().post(`${API}/grievances/${id}/notes`).set(t.asha.h).send({ body: 'One more thing' })).status).toBe(409);

    const audit = await AuditLog.findAll({ where: { entityId: id }, ...RAW });
    expect(audit.length).toBeGreaterThan(8);
    for (const a of audit) expect(a.summary).toMatch(/^GRV-0001 /);
  });

  it('keeps POSH complaints to the Internal Committee, away from HR, admins and anyone involved', async () => {
    const t = await team();
    await raise(t, t.asha, {});
    expect((await ctx.http().get(`${API}/grievances/committee`).set(t.asha.h)).body.data).toEqual([{ name: 'Indira Person' }, { name: 'Ishaan Person' }]);

    // More than 3 months after the incident needs a reason for the delay.
    const late = { category: 'POSH', subject: 'Inappropriate remarks', description: 'Repeated comments about my appearance during team meetings.', respondentId: t.ben.employee.id, incidentDate: daysAgo(130) };
    expect((await raise(t, t.asha, late)).status).toBe(422);
    const created = await raise(t, t.asha, { ...late, delayReason: 'I was on medical leave until last week.', interimRelief: 'Move me to another team during the inquiry' });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.reference).toBe('POSH-0001');
    expect(await Notification.count({ where: { userId: [t.ic.user.id, t.ic2.user.id], link: `/hr/grievances/${id}` }, ...RAW })).toBe(2);
    expect(await Notification.count({ where: { userId: [t.hr.user.id, t.org.admin.id], link: `/hr/grievances/${id}` }, ...RAW })).toBe(0);

    // HR and the Organization Admin can't see it at all.
    const admin = t.h;
    for (const h of [t.hr.h, admin]) {
      expect((await ctx.http().get(`${API}/grievances/${id}`).set(h)).status).toBe(404);
      expect((await ctx.http().get(`${API}/grievances?view=all`).set(h)).body.data.map((c: { reference: string }) => c.reference)).toEqual(['GRV-0001']);
      expect((await ctx.http().get(`${API}/grievances?view=posh`).set(h)).status).toBe(403);
      expect((await ctx.http().get(`${API}/grievances/posh-report`).set(h)).status).toBe(403);
      expect((await ctx.http().post(`${API}/grievances/${id}/assign`).set(h).send({ assigneeUserId: null })).status).toBe(404);
    }
    expect((await ctx.http().get(`${API}/grievances/stats`).set(t.hr.h)).body.data.posh).toBeUndefined();

    // The committee sees and handles it.
    expect((await ctx.http().get(`${API}/grievances?view=posh`).set(t.ic.h)).body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await ctx.http().get(`${API}/grievances?view=all`).set(t.ic.h)).status).toBe(403);
    const seen = (await ctx.http().get(`${API}/grievances/${id}`).set(t.ic.h)).body.data;
    expect(seen.permissions.manage).toBe(true);
    expect(seen.poshDetails).toEqual({ delayReason: 'I was on medical leave until last week.', interimRelief: 'Move me to another team during the inquiry', conciliationRequested: false, filing: 'LATE' });
    const handlers = (await ctx.http().get(`${API}/grievances/${id}/handlers`).set(t.ic.h)).body.data.map((u: { id: string }) => u.id).sort();
    expect(handlers).toEqual([t.ic.user.id, t.ic2.user.id].sort());
    expect((await ctx.http().post(`${API}/grievances/${id}/assign`).set(t.ic.h).send({ assigneeUserId: t.hr.user.id })).status).toBe(422);
    await ctx.http().post(`${API}/grievances/${id}/assign`).set(t.ic.h).send({ assigneeUserId: t.ic.user.id });
    // Settlement needs the complainant's request for conciliation.
    expect((await ctx.http().post(`${API}/grievances/${id}/resolve`).set(t.ic.h).send({ outcome: 'SETTLED', summary: 'Settled between the parties.' })).status).toBe(422);
    await ctx.http().post(`${API}/grievances/${id}/resolve`).set(t.ic.h).send({ outcome: 'UPHELD', summary: 'The committee found the complaint proved.', actions: 'Written warning and transfer of the respondent.' });
    const reopen = await ctx.http().post(`${API}/grievances/${id}/reopen`).set(t.asha.h).send({ reason: 'I disagree with the recommendation.' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.error.message).toMatch(/appellate authority/);
    expect((await ctx.http().post(`${API}/grievances/${id}/close`).set(t.ic.h).send({})).body.data.status).toBe('CLOSED');

    const report = (await ctx.http().get(`${API}/grievances/posh-report`).set(t.ic.h)).body.data;
    expect(report).toMatchObject({ received: 1, disposed: 1, pending: 0, outcomes: { UPHELD: 1 } });

    // A committee member named in a complaint can't see or handle it; the rest of the committee can.
    const aboutIc = await raise(t, t.asha, { category: 'POSH', subject: 'Unwelcome messages', description: 'Late-night personal messages after I declined.', respondentId: t.ic.employee.id });
    expect(aboutIc.body.data.reference).toBe('POSH-0002');
    expect((await ctx.http().get(`${API}/grievances/${aboutIc.body.data.id}`).set(t.ic.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/grievances?view=posh`).set(t.ic.h)).body.data.map((c: { id: string }) => c.id)).toEqual([id]);
    expect(await Notification.count({ where: { userId: t.ic.user.id, link: `/hr/grievances/${aboutIc.body.data.id}` }, ...RAW })).toBe(0);
    expect((await ctx.http().get(`${API}/grievances/${aboutIc.body.data.id}/handlers`).set(t.ic2.h)).body.data.map((u: { id: string }) => u.id)).toEqual([t.ic2.user.id]);
  });

  it('lets the complainant withdraw or accept, and isolates organizations', async () => {
    const t = await team();
    const first = (await raise(t, t.asha, {})).body.data.id;
    const withdrawn = await ctx.http().post(`${API}/grievances/${first}/withdraw`).set(t.asha.h).send({ reason: 'Sorted it out directly.' });
    expect(withdrawn.body.data).toMatchObject({ status: 'WITHDRAWN', notes: [expect.objectContaining({ body: 'Withdrawn: Sorted it out directly.' })] });
    expect((await ctx.http().post(`${API}/grievances/${first}/acknowledge`).set(t.hr.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/grievances/${first}/withdraw`).set(t.hr.h).send({})).status).toBe(403);

    const second = (await raise(t, t.asha, { category: 'PAY_BENEFITS', subject: 'Overtime not paid for October' })).body.data.id;
    expect((await ctx.http().post(`${API}/grievances/${second}/resolve`).set(t.hr.h).send({ outcome: 'UPHELD', summary: 'Overtime added to November payroll.' })).status).toBe(409);
    await ctx.http().post(`${API}/grievances/${second}/acknowledge`).set(t.hr.h).send({});
    await ctx.http().post(`${API}/grievances/${second}/resolve`).set(t.hr.h).send({ outcome: 'UPHELD', summary: 'Overtime added to November payroll.' });
    const accepted = await ctx.http().post(`${API}/grievances/${second}/accept`).set(t.asha.h).send({});
    expect(accepted.body.data).toMatchObject({ status: 'CLOSED', acceptedAt: expect.any(String) });
    expect((await ctx.http().get(`${API}/grievances/mine`).set(t.asha.h)).body.data.map((c: { status: string }) => c.status)).toEqual(['CLOSED', 'WITHDRAWN']);
    expect((await ctx.http().get(`${API}/grievances/stats`).set(t.hr.h)).body.data).toEqual({ assigned: { open: 0, overdue: 0 }, all: { open: 0, overdue: 0, unassigned: 0 } });

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/grievances/${second}`).set(oh)).status).toBe(404);
    expect((await ctx.http().get(`${API}/grievances?view=all`).set(oh)).body.data).toEqual([]);
  });
});
