import { ReportSchedule } from '../src/database/models';
import { MailService } from '../src/infrastructure/mail/mail.service';
import { ReportSchedulesService } from '../src/modules/reports/schedules/report-schedules.service';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Scheduled reports (e2e)', () => {
  let ctx: TestContext;
  let mail: MailService;

  beforeAll(async () => {
    ctx = await createTestApp();
    mail = ctx.app.get(MailService);
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    mail.outbox.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    async function member(roles: string[]) {
      const user = await createUser(ctx, { email: uniqueEmail('m'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roles);
      await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2021-04-01', membershipId: membership.id });
      return { user, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const hr = await member(['hr_manager']);
    const manager = await member(['department_manager']);
    const report = (
      await ctx.http().post(`${API}/reports/saved`).set(h).send({ name: 'Headcount list', query: { dataset: 'employees', columns: ['employeeCode', 'employee', 'dateOfJoining'] } })
    ).body.data.find((r: { name: string }) => r.name === 'Headcount list');
    return { ...org, h, hr, manager, report };
  }

  it('emails a saved report to each recipient with their own access, now and on schedule', async () => {
    const s = await setup();
    const body = { savedReportId: s.report.id, frequency: 'WEEKLY', dayOfWeek: 1, hour: 8, format: 'xlsx', period: 'PREVIOUS_WEEK', recipientIds: [s.admin.id, s.hr.user.id, s.manager.user.id] };

    // Validation: weekly needs a day; recipients must be members; only the report's owner can schedule it.
    expect((await ctx.http().post(`${API}/reports/schedules`).set(s.h).send({ ...body, dayOfWeek: null })).status).toBe(422);
    const outsider = await createUser(ctx, { email: uniqueEmail('out') });
    expect((await ctx.http().post(`${API}/reports/schedules`).set(s.h).send({ ...body, recipientIds: [outsider.id] })).status).toBe(422);
    expect((await ctx.http().post(`${API}/reports/schedules`).set(s.hr.h).send(body)).status).toBe(404);
    // The department manager can view reports but not export them: no scheduling.
    expect((await ctx.http().get(`${API}/reports/schedules`).set(s.manager.h)).status).toBe(403);

    const created = await ctx.http().post(`${API}/reports/schedules`).set(s.h).send(body);
    expect(created.status).toBe(201);
    const schedule = created.body.data;
    expect(schedule).toMatchObject({ reportName: 'Headcount list', frequency: 'WEEKLY', dayOfWeek: 1, isActive: true, lastStatus: null });
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());
    expect(schedule.recipients.map((r: { name: string }) => r.name)).toHaveLength(3);
    expect((await ctx.http().get(`${API}/reports/schedules/recipients?q=Person`).set(s.h)).body.data.length).toBeGreaterThanOrEqual(2);

    // Send now: admin and HR get the file; the manager (no export rights) is skipped and that's reported.
    const sent = (await ctx.http().post(`${API}/reports/schedules/${schedule.id}/send`).set(s.h)).body.data;
    expect(sent.lastStatus).toBe('PARTIAL');
    expect(sent.lastError).toContain('Skipped');
    expect(sent.nextRunAt).toBe(schedule.nextRunAt);
    const toAdmin = mail.outbox.find((m) => m.to === s.admin.email)!;
    const toHr = mail.outbox.find((m) => m.to === s.hr.user.email)!;
    expect(mail.outbox.find((m) => m.to === s.manager.user.email)).toBeUndefined();
    expect(toAdmin.subject).toContain('Headcount list');
    expect(toAdmin.attachments?.[0]).toMatchObject({ filename: 'headcount-list.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(Buffer.from(toAdmin.attachments![0]!.content, 'base64').subarray(0, 2).toString()).toBe('PK');
    expect(toHr.text).toMatch(/\d+ rows?/);

    // On schedule: a due run goes out once and moves to the next week.
    mail.outbox.length = 0;
    await ReportSchedule.update({ nextRunAt: new Date(Date.now() - 60_000) }, { where: { id: schedule.id }, ...RAW, skipTenantScope: true });
    const job = ctx.app.get(ReportSchedulesService);
    expect(await job.tick()).toBe(1);
    expect(await job.tick()).toBe(0);
    expect(mail.outbox.filter((m) => m.subject.includes('Headcount list'))).toHaveLength(2);
    const after = (await ReportSchedule.findByPk(schedule.id, { ...RAW, skipTenantScope: true }))!;
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    // Monday 08:00 in the organization's timezone.
    expect(new Intl.DateTimeFormat('en-US', { timeZone: (await ctx.http().get(`${API}/organizations/current`).set(s.h)).body.data?.timezone ?? 'UTC', weekday: 'short' }).format(after.nextRunAt!)).toBe('Mon');

    // Pausing stops runs; deleting the saved report removes its schedules.
    const paused = (await ctx.http().put(`${API}/reports/schedules/${schedule.id}`).set(s.h).send({ ...body, isActive: false })).body.data;
    expect(paused).toMatchObject({ isActive: false, nextRunAt: null });
    await ctx.http().delete(`${API}/reports/saved/${s.report.id}`).set(s.h);
    expect((await ctx.http().get(`${API}/reports/schedules`).set(s.h)).body.data).toEqual([]);
  });

  it('dated reports cover the rolling period', async () => {
    const s = await setup();
    const saved = (
      await ctx.http().post(`${API}/reports/saved`).set(s.h).send({ name: 'Leave last month', query: { dataset: 'leave_requests', columns: ['employee', 'startDate', 'days'], from: '2026-01-01', to: '2026-01-31' } })
    ).body.data.find((r: { name: string }) => r.name === 'Leave last month');
    const schedule = (await ctx.http().post(`${API}/reports/schedules`).set(s.h).send({ savedReportId: saved.id, frequency: 'MONTHLY', dayOfMonth: 1, hour: 7, format: 'csv', period: 'PREVIOUS_MONTH', recipientIds: [s.admin.id] })).body.data;
    await ctx.http().post(`${API}/reports/schedules/${schedule.id}/send`).set(s.h);
    const m = mail.outbox.find((x) => x.to === s.admin.email)!;
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    expect(m.subject).toContain(`${prev}-01 to`);
    expect(m.attachments?.[0]?.filename).toBe('leave-last-month.csv');
  });
});
