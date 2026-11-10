import { addDays } from '../src/common/utils/zoned-time';
import { weekStartOf } from '../src/contracts';
import { Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgDays, resetDatabase, uniqueEmail } from './helpers';

describe('Timesheets (e2e)', () => {
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
    const user = await createUser(ctx, { email: uniqueEmail('t') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const lead = await person(org.organization.id, h, ['team_lead']);
    const asha = await person(org.organization.id, h, ['employee'], { managerId: lead.employee.id });
    const ravi = await person(org.organization.id, h, ['employee'], { managerId: lead.employee.id });
    return { org, h, lead, asha, ravi, week: weekStartOf(orgDays(-7)) };
  }
  const entry = (day: number, project: string, start: string | null, end: string | null, minutes?: number) => ({ day, project, activity: 'Development', start, end, ...(minutes ? { minutes } : {}) });

  it('saves, submits, sends back and approves a week, with the rules enforced', async () => {
    const s = await setup();
    const url = `${API}/attendance/timesheets`;
    const week = await ctx.http().get(`${url}/week`).query({ weekStart: s.week }).set(s.asha.h);
    expect(week.status).toBe(200);
    expect(week.body.data.days).toHaveLength(7);
    expect(week.body.data.canEdit).toBe(true);

    // Validation: overlapping times, a future week, a day of the week given as a non-Monday.
    const overlap = await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: s.week, entries: [entry(0, 'Payroll', '09:00', '13:00'), entry(0, 'Support', '12:00', '14:00')] });
    expect(overlap.status).toBe(422);
    expect(JSON.stringify(overlap.body.error.details)).toMatch(/overlaps/);
    expect((await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: addDays(weekStartOf(orgDays(0)), 7), entries: [] })).status).toBe(422);
    expect((await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: addDays(s.week, 1), entries: [] })).status).toBe(422);
    expect((await ctx.http().post(`${url}/week/submit`).set(s.asha.h).send({ weekStart: s.week, entries: [] })).status).toBe(422);

    const entries = [entry(0, 'Payroll migration', '09:00', '13:00'), entry(0, 'Payroll migration', '14:00', '18:00'), entry(1, 'Support', null, null, 450)];
    const draft = await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: s.week, entries });
    expect(draft.status).toBe(200);
    expect(draft.body.data.timesheet).toMatchObject({ status: 'DRAFT', totalMinutes: 8 * 60 + 450 });

    const submitted = await ctx.http().post(`${url}/week/submit`).set(s.asha.h).send({ weekStart: s.week, entries, note: 'Migration week' });
    expect(submitted.body.data.timesheet.status).toBe('SUBMITTED');
    const id = submitted.body.data.timesheet.id;
    expect((await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: s.week, entries })).status).toBe(409);
    expect(await Notification.count({ where: { userId: s.lead.user.id, type: 'attendance.timesheet' }, ...RAW })).toBe(1);

    // The team lead reviews; the employee can't review at all, and another employee can't see it.
    expect((await ctx.http().post(`${url}/${id}/approve`).set(s.asha.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${url}/${id}`).set(s.ravi.h)).status).toBe(404);
    const queue = await ctx.http().get(url).query({ view: 'team', status: 'SUBMITTED' }).set(s.lead.h);
    expect(queue.body.data.map((t: { id: string }) => t.id)).toEqual([id]);
    expect((await ctx.http().post(`${url}/${id}/reject`).set(s.lead.h).send({})).status).toBe(422);
    const rejected = await ctx.http().post(`${url}/${id}/reject`).set(s.lead.h).send({ note: 'Split Monday by module, please' });
    expect(rejected.status).toBe(201);

    // Sent back: editable again, then resubmitted and approved; approved weeks are locked.
    const resubmit = await ctx.http().post(`${url}/week/submit`).set(s.asha.h).send({ weekStart: s.week, entries: [...entries.slice(1), entry(0, 'Payroll – reports', '09:00', '13:00')] });
    expect(resubmit.body.data.timesheet.status).toBe('SUBMITTED');
    expect((await ctx.http().post(`${url}/${id}/approve`).set(s.lead.h).send({})).status).toBe(201);
    expect((await ctx.http().post(`${url}/${id}/approve`).set(s.lead.h).send({})).status).toBe(409);
    expect((await ctx.http().put(`${url}/week`).set(s.asha.h).send({ weekStart: s.week, entries })).status).toBe(409);
    expect((await ctx.http().get(`${url}/week`).query({ weekStart: s.week }).set(s.asha.h)).body.data.timesheet.status).toBe('APPROVED');
  });

  it('shows the week board with missing timesheets and reminds the people outstanding', async () => {
    const s = await setup();
    const url = `${API}/attendance/timesheets`;
    await ctx.http().post(`${url}/week/submit`).set(s.asha.h).send({ weekStart: s.week, entries: [entry(0, 'Payroll', '09:00', '17:00')] });
    const board = await ctx.http().get(`${url}/board`).query({ weekStart: s.week }).set(s.lead.h);
    expect(board.status).toBe(200);
    const status = (id: string) => board.body.data.items.find((r: { employee: { id: string } }) => r.employee.id === id)?.status;
    expect(status(s.asha.employee.id)).toBe('SUBMITTED');
    expect(status(s.ravi.employee.id)).toBe('MISSING');
    expect((await ctx.http().get(`${url}/board`).set(s.asha.h)).status).toBe(403);

    const reminded = await ctx.http().post(`${url}/remind`).set(s.lead.h).send({ weekStart: s.week });
    expect(reminded.body.data.reminded).toBeGreaterThanOrEqual(1);
    expect(await Notification.count({ where: { userId: s.ravi.user.id, type: 'attendance.timesheet' }, ...RAW })).toBe(1);
    expect(await Notification.count({ where: { userId: s.asha.user.id, type: 'attendance.timesheet' }, ...RAW })).toBe(0);
    expect((await ctx.http().post(`${url}/remind`).set(s.lead.h).send({ weekStart: addDays(weekStartOf(orgDays(0)), 7) })).status).toBe(422);
  });
});
