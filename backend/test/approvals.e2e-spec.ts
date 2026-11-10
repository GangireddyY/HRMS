import { addDays, weekday } from '../src/common/utils/zoned-time';
import { LeaveLedgerEntry, Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';

/** The Monday at least a week ahead, so notice rules never get in the way. */
const nextMonday = () => {
  let d = addDays(orgToday(), 7);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
};

describe('Approval delegation and two-level leave approval (e2e)', () => {
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
      const user = await createUser(ctx, { email: uniqueEmail('p'), firstName: roleKeys[0] === 'team_lead' ? 'Lena' : 'Pat', lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx
        .http()
        .post(`${API}/employees`)
        .set(h)
        .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const types = (await ctx.http().post(`${API}/leave/types/recommended`).set(h)).body.data.types as { id: string; code: string }[];
    const cl = types.find((t) => t.code === 'CL')!;
    return { ...org, h, person, cl };
  }

  it('lets a colleague approve for an away manager, only for their team and only while it runs', async () => {
    const { cl, person } = await setup();
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    const cover = await person(['employee']);
    const outsider = await person(['employee']);
    const monday = nextMonday();
    const apply = (who: { h: Record<string, string> }, day: string) =>
      ctx.http().post(`${API}/leave/requests`).set(who.h).send({ leaveTypeId: cl.id, startDate: day, endDate: day, reason: 'Family function' });

    const today = orgToday();
    const delegate = (who: { h: Record<string, string> }, body: Record<string, unknown>) => ctx.http().post(`${API}/approvals/delegations`).set(who.h).send(body);
    expect((await delegate(cover, { delegateEmployeeId: lead.employee.id, startsOn: today, endsOn: addDays(today, 3) })).status).toBe(403);
    expect((await delegate(lead, { delegateEmployeeId: cover.employee.id, startsOn: addDays(today, -1), endsOn: addDays(today, 3) })).status).toBe(422);
    expect((await delegate(lead, { delegateEmployeeId: cover.employee.id, startsOn: today, endsOn: addDays(today, 120) })).status).toBe(422);
    const given = await delegate(lead, { delegateEmployeeId: cover.employee.id, startsOn: today, endsOn: addDays(today, 5), reason: 'On leave' });
    expect(given.status).toBe(201);
    expect(given.body.data).toMatchObject({ status: 'ACTIVE', delegate: 'Pat Person', canEnd: true });
    expect((await delegate(lead, { delegateEmployeeId: outsider.employee.id, startsOn: addDays(today, 2), endsOn: addDays(today, 4) })).status).toBe(409);
    expect(await Notification.count({ where: { userId: cover.user.id, type: 'approvals.delegation' }, ...RAW })).toBe(1);

    const me = (await ctx.http().get(`${API}/auth/me`).set(cover.h)).body.data;
    expect(me.permissions['leave.approve']).toBe('TEAM');
    expect(me.actingFor).toEqual([expect.objectContaining({ name: 'Lena Person', permissions: expect.arrayContaining(['leave.approve', 'attendance.regularize.approve']) })]);

    const mine = (await apply(report, monday)).body.data;
    const leadsOwn = (await apply(lead, addDays(monday, 1))).body.data;
    const outsiders = (await apply(outsider, addDays(monday, 2))).body.data;
    expect(await Notification.count({ where: { userId: cover.user.id, type: 'leave.request' }, ...RAW })).toBe(1);

    const team = (await ctx.http().get(`${API}/leave/requests?view=team&status=PENDING`).set(cover.h)).body.data as { id: string; onBehalfOf: string | null; canApprove: boolean }[];
    expect(team.map((r) => r.id)).toEqual([mine.id]);
    expect(team[0]).toMatchObject({ onBehalfOf: 'Lena Person', canApprove: true });
    expect((await ctx.http().post(`${API}/leave/requests/${leadsOwn.id}/approve`).set(cover.h).send({})).status).toBe(404);
    expect((await ctx.http().post(`${API}/leave/requests/${outsiders.id}/approve`).set(cover.h).send({})).status).toBe(404);
    const approved = await ctx.http().post(`${API}/leave/requests/${mine.id}/approve`).set(cover.h).send({ note: 'Covering for Lena' });
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: 'Pat Person' });

    // Declined by the delegate: the rights go away at once.
    const ended = await ctx.http().post(`${API}/approvals/delegations/${given.body.data.id}/revoke`).set(cover.h).send({});
    expect(ended.body.data.status).toBe('REVOKED');
    const later = (await apply(report, addDays(monday, 3))).body.data;
    expect((await ctx.http().post(`${API}/leave/requests/${later.id}/approve`).set(cover.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/auth/me`).set(cover.h)).body.data.actingFor).toEqual([]);
    const overview = (await ctx.http().get(`${API}/approvals/delegations`).set(lead.h)).body.data;
    expect(overview).toMatchObject({ canDelegate: true, given: [expect.objectContaining({ status: 'REVOKED' })], received: [] });
  });

  it('sends long leave to HR after the manager, and HR must be someone else', async () => {
    const { h, cl, person } = await setup();
    const hr = await person(['hr_manager']);
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    expect((await ctx.http().patch(`${API}/leave/types/${cl.id}`).set(h).send({ approvalLevels: 2, secondApprovalMinDays: 1 })).body.data).toMatchObject({
      approvalLevels: 2,
      secondApprovalMinDays: 1,
    });
    const monday = nextMonday();
    const apply = (start: string, end: string) => ctx.http().post(`${API}/leave/requests`).set(report.h).send({ leaveTypeId: cl.id, startDate: start, endDate: end, reason: 'Trip' });

    const short = (await apply(addDays(monday, 3), addDays(monday, 3))).body.data;
    expect(short.approval).toMatchObject({ level: 1, levels: 1 });
    expect((await ctx.http().post(`${API}/leave/requests/${short.id}/approve`).set(lead.h).send({})).body.data.status).toBe('APPROVED');

    const long = (await apply(monday, addDays(monday, 1))).body.data;
    expect(long.approval).toMatchObject({ level: 1, levels: 2, awaiting: 'Manager' });
    const first = await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(lead.h).send({ note: 'Fine by me' });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ status: 'PENDING', approval: { level: 2, awaiting: 'HR', trail: [expect.objectContaining({ level: 1, name: 'Lena Person', note: 'Fine by me' })] } });
    expect(await Notification.count({ where: { userId: hr.user.id, type: 'leave.request' }, ...RAW })).toBe(1);

    expect((await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(lead.h).send({})).status).toBe(403);
    const leadView = (await ctx.http().get(`${API}/leave/requests?view=team&status=PENDING`).set(lead.h)).body.data as { id: string; canApprove: boolean }[];
    expect(leadView.find((r) => r.id === long.id)!.canApprove).toBe(false);
    expect(await LeaveLedgerEntry.count({ where: { leaveRequestId: long.id }, ...RAW })).toBe(0);

    const done = await ctx.http().post(`${API}/leave/requests/${long.id}/approve`).set(hr.h).send({});
    expect(done.body.data).toMatchObject({ status: 'APPROVED', approval: { level: 2, awaiting: null } });
    expect(done.body.data.approval.trail).toHaveLength(2);
    expect(await LeaveLedgerEntry.count({ where: { leaveRequestId: long.id, kind: 'TAKEN' }, ...RAW })).toBe(1);

    // HR approving the first level can't also give the second.
    const third = (await apply(addDays(monday, 7), addDays(monday, 8))).body.data;
    expect((await ctx.http().post(`${API}/leave/requests/${third.id}/approve`).set(hr.h).send({})).body.data.approval.level).toBe(2);
    expect((await ctx.http().post(`${API}/leave/requests/${third.id}/approve`).set(hr.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/leave/requests/${third.id}/reject`).set(lead.h).send({ note: 'Team offsite that week' })).body.data.status).toBe('REJECTED');
  });
});
