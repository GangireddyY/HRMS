import { MailService, type MailMessage } from '../src/infrastructure/mail/mail.service';
import { addDays } from '../src/common/utils/zoned-time';
import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';

/** The Monday `weeks` weeks after next. */
function monday(weeks: number): string {
  const today = orgToday();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, ((8 - dow) % 7 || 7) + 7 * weeks);
}
const ics = (m: MailMessage | undefined) => (m?.attachments?.[0] ? Buffer.from(m.attachments[0].content, 'base64').toString('utf8').replace(/\r\n /g, '') : '');

describe('Calendar invites and feeds (e2e)', () => {
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
    const eng = (await ctx.http().post(`${API}/departments`).set(h).send({ name: 'Engineering' })).body.data;
    async function person(roles: string[], extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roles);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    const manager = await person(['department_manager'], { departmentId: eng.id });
    const asha = await person(['employee'], { departmentId: eng.id, managerId: manager.employee.id });
    return { ...org, h, eng, manager, asha, person };
  }

  const invitesTo = (email: string) => mail.outbox.filter((m) => m.to === email && m.attachments?.some((a) => a.type.startsWith('text/calendar')));

  it('sends leave and 1:1 invites (updates and cancellations too), and respects the opt-out', async () => {
    const s = await setup();
    const type = (await ctx.http().post(`${API}/leave/types`).set(s.h).send({ code: 'CL', name: 'Casual leave', annualQuota: 24, accrualFrequency: 'YEARLY' })).body.data;
    const leave = (await ctx.http().post(`${API}/leave/requests`).set(s.asha.h).send({ leaveTypeId: type.id, startDate: monday(1), endDate: addDays(monday(1), 2), reason: 'Family trip' })).body.data;
    expect(invitesTo(s.asha.user.email)).toHaveLength(0);
    await ctx.http().post(`${API}/leave/requests/${leave.id}/approve`).set(s.manager.h).send({});
    const [invite] = invitesTo(s.asha.user.email);
    const body = ics(invite);
    // SendGrid rejects attachment types with parameters (`;`); the method travels in the file.
    expect(invite!.attachments![0]!.type).toBe('text/calendar');
    expect(body).toContain('METHOD:REQUEST');
    expect(body).toContain(`UID:leave-${leave.id}@hrms`);
    expect(body).toContain(`DTSTART;VALUE=DATE:${monday(1).replace(/-/g, '')}`);
    expect(body).toContain(`DTEND;VALUE=DATE:${addDays(monday(1), 3).replace(/-/g, '')}`);
    expect(body).toContain('SUMMARY:Out of office: Casual leave');

    // Cancelling approved leave removes it from the calendar.
    mail.outbox.length = 0;
    await ctx.http().post(`${API}/leave/requests/${leave.id}/cancel`).set(s.asha.h).send({});
    expect(ics(invitesTo(s.asha.user.email)[0])).toContain('METHOD:CANCEL');

    // A 1:1: both people get it; a reschedule updates the same event with a higher sequence; cancel removes it.
    mail.outbox.length = 0;
    const at = new Date(`${monday(2)}T05:30:00Z`).toISOString();
    const meeting = (await ctx.http().post(`${API}/performance/one-on-ones`).set(s.manager.h).send({ employeeId: s.asha.employee.id, scheduledAt: at, durationMinutes: 30 })).body.data;
    const first = ics(invitesTo(s.asha.user.email)[0]);
    expect(first).toContain(`UID:one-on-one-${meeting.id}@hrms`);
    expect(first).toContain('DTSTART:' + at.replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
    expect(invitesTo(s.manager.user.email)).toHaveLength(1);
    const seq = (text: string) => Number(/SEQUENCE:(\d+)/.exec(text)![1]);
    await new Promise((r) => setTimeout(r, 1100));
    mail.outbox.length = 0;
    await ctx.http().patch(`${API}/performance/one-on-ones/${meeting.id}`).set(s.manager.h).send({ scheduledAt: new Date(`${monday(2)}T08:30:00Z`).toISOString() });
    const moved = ics(invitesTo(s.asha.user.email)[0]);
    expect(moved).toContain('DTSTART:20');
    expect(seq(moved)).toBeGreaterThan(seq(first));

    // Opting out stops invites for that person only.
    await ctx.http().put(`${API}/notifications/settings`).set(s.asha.h).send({ email: true, muted: [], calendarInvites: false });
    expect((await ctx.http().get(`${API}/notifications/settings`).set(s.asha.h)).body.data.calendarInvites).toBe(false);
    mail.outbox.length = 0;
    await ctx.http().post(`${API}/performance/one-on-ones/${meeting.id}/cancel`).set(s.manager.h).send({});
    expect(invitesTo(s.asha.user.email)).toHaveLength(0);
    expect(ics(invitesTo(s.manager.user.email)[0])).toContain('METHOD:CANCEL');
  });

  it('invites the candidate and the panel to interviews', async () => {
    const s = await setup();
    const hr = await s.person(['hr_manager']);
    const recruiter = await s.person(['recruiter']);
    const designation = (await ctx.http().post(`${API}/designations`).set(s.h).send({ name: 'Engineer' })).body.data;
    const req = (await ctx.http().post(`${API}/recruitment/requisitions`).set(s.manager.h).send({ title: 'Engineer', designationId: designation.id, reason: 'NEW_ROLE', justification: 'Team growth for the platform', openings: 1, submit: true })).body.data;
    await ctx.http().post(`${API}/recruitment/requisitions/${req.id}/approve`).set(hr.h).send({});
    const job = (await ctx.http().post(`${API}/recruitment/jobs`).set(recruiter.h).send({ requisitionId: req.id, description: 'Build services in TypeScript and PostgreSQL.' })).body.data;
    await ctx.http().post(`${API}/recruitment/jobs/${job.id}/status`).set(recruiter.h).send({ status: 'OPEN' });
    const candidate = (await ctx.http().post(`${API}/recruitment/candidates`).set(recruiter.h).send({ firstName: 'Meera', lastName: 'Iyer', email: 'meera@example.com', jobId: job.id })).body.data;
    const appId = candidate.applications[0].id as string;

    const scheduledAt = new Date(`${monday(1)}T06:00:00Z`).toISOString();
    await ctx.http().post(`${API}/recruitment/applications/${appId}/interviews`).set(recruiter.h).send({ roundName: 'Technical round', scheduledAt, durationMinutes: 45, mode: 'VIDEO', location: 'https://meet.example.com/abc', panelistIds: [s.manager.employee.id] });
    const toCandidate = ics(invitesTo('meera@example.com')[0]);
    expect(toCandidate).toContain('SUMMARY:Interview for Engineer: Technical round');
    expect(toCandidate).toContain('LOCATION:https://meet.example.com/abc');
    expect(toCandidate).toContain('DTEND:' + new Date(Date.parse(scheduledAt) + 45 * 60_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
    expect(ics(invitesTo(s.manager.user.email)[0])).toContain('SUMMARY:Interview: Meera Iyer (Technical round');

    // Swapping the panelist cancels for the one removed; cancelling the interview cancels for everyone.
    const interviewId = (await ctx.http().get(`${API}/recruitment/applications/${appId}`).set(recruiter.h)).body.data.interviews[0].id as string;
    mail.outbox.length = 0;
    await ctx.http().patch(`${API}/recruitment/interviews/${interviewId}`).set(recruiter.h).send({ panelistIds: [hr.employee.id] });
    expect(ics(invitesTo(s.manager.user.email)[0])).toContain('METHOD:CANCEL');
    expect(ics(invitesTo(hr.user.email)[0])).toContain('METHOD:REQUEST');
    mail.outbox.length = 0;
    await ctx.http().post(`${API}/recruitment/interviews/${interviewId}/cancel`).set(recruiter.h).send({});
    expect(ics(invitesTo('meera@example.com')[0])).toContain('METHOD:CANCEL');
  });

  it('serves a private calendar feed with leave, team leave, 1:1s and holidays', async () => {
    const s = await setup();
    const type = (await ctx.http().post(`${API}/leave/types`).set(s.h).send({ code: 'CL', name: 'Casual leave', annualQuota: 24, accrualFrequency: 'YEARLY' })).body.data;
    const leave = (await ctx.http().post(`${API}/leave/requests`).set(s.asha.h).send({ leaveTypeId: type.id, startDate: monday(1), endDate: monday(1), reason: 'Errand' })).body.data;
    await ctx.http().post(`${API}/leave/requests/${leave.id}/approve`).set(s.manager.h).send({});
    await ctx.http().post(`${API}/performance/one-on-ones`).set(s.manager.h).send({ employeeId: s.asha.employee.id, scheduledAt: new Date(`${monday(2)}T05:30:00Z`).toISOString() });
    await ctx.http().post(`${API}/holidays`).set(s.h).send({ date: monday(3), name: 'Founders Day' });

    expect((await ctx.http().get(`${API}/calendar/feed`).set(s.manager.h)).body.data).toEqual({ active: false });
    const { url } = (await ctx.http().post(`${API}/calendar/feed`).set(s.manager.h)).body.data;
    expect(url).toMatch(/\/api\/v1\/calendar\/feed\/[\w-]+\.ics$/);
    const path = url.slice(url.indexOf('/api/v1'));
    const feed = await ctx.http().get(path);
    expect(feed.status).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    const text = feed.text.replace(/\r\n /g, '');
    expect(text).toContain('METHOD:PUBLISH');
    expect(text).toContain(`UID:leave-${leave.id}@hrms`);
    expect(text).toContain('away (Casual leave)');
    expect(text).toContain('SUMMARY:1:1 with');
    expect(text).toContain('SUMMARY:Founders Day');

    // Rotating replaces the URL; removing switches it off; unknown tokens are 404.
    const next = (await ctx.http().post(`${API}/calendar/feed`).set(s.manager.h)).body.data.url;
    expect((await ctx.http().get(path)).status).toBe(404);
    await ctx.http().post(`${API}/calendar/feed/remove`).set(s.manager.h);
    expect((await ctx.http().get(next.slice(next.indexOf('/api/v1')))).status).toBe(404);
    expect((await ctx.http().get(`${API}/calendar/feed/not-a-real-token-value-xyz.ics`)).status).toBe(404);
  });
});
