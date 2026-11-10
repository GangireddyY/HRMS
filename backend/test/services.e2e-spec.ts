import { addDays } from '../src/common/utils/zoned-time';
import { HelpdeskTicket, Notification } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';

describe('Assets, helpdesk and travel (e2e)', () => {
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
      const user = await createUser(ctx, { email: uniqueEmail('p'), firstName: roleKeys[0] === 'team_lead' ? 'Lena' : roleKeys[0] === 'hr_manager' ? 'Hari' : 'Pat', lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx
        .http()
        .post(`${API}/employees`)
        .set(h)
        .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    return { ...org, h, person };
  }

  it('tracks assets from the register to an employee and back', async () => {
    const { person } = await setup();
    const hr = await person(['hr_manager']);
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    const other = await person(['employee']);
    const post = (who: { h: Record<string, string> }, path: string, body: Record<string, unknown> = {}) => ctx.http().post(`${API}/assets${path}`).set(who.h).send(body);

    expect((await post(report, '', { name: 'Laptop', category: 'LAPTOP' })).status).toBe(403);
    const laptop = await post(hr, '', { name: 'ThinkPad X1', category: 'LAPTOP', serialNumber: 'SN-1', purchaseCost: 120000 });
    expect(laptop.status).toBe(201);
    expect(laptop.body.data).toMatchObject({ tag: 'AST-0001', status: 'IN_STOCK', condition: 'NEW', purchaseCost: 120000 });
    expect((await post(hr, '', { name: 'Other', category: 'LAPTOP', serialNumber: 'sn-1' })).status).toBe(422);
    const monitor = (await post(hr, '', { name: 'Dell 27"', category: 'MONITOR' })).body.data;
    expect(monitor.tag).toBe('AST-0002');

    // The employee asks; HR hands over the laptop against the request.
    const asked = await post(report, '/requests', { category: 'LAPTOP', reason: 'Joining the mobile team' });
    expect(asked.status).toBe(201);
    expect((await post(report, '/requests', { category: 'LAPTOP', reason: 'Again please' })).status).toBe(409);
    expect(await Notification.count({ where: { userId: hr.user.id, type: 'assets.request' }, ...RAW })).toBe(1);
    const requestId = asked.body.data.requests[0].id;
    expect((await post(hr, `/requests/${requestId}/fulfil`, { assetId: laptop.body.data.id })).body.data.status).toBe('FULFILLED');
    expect((await post(hr, `/${laptop.body.data.id}/assign`, { employeeId: other.employee.id })).status).toBe(409);

    const mine = (await ctx.http().get(`${API}/assets/mine`).set(report.h)).body.data;
    expect(mine.assets).toEqual([expect.objectContaining({ tag: 'AST-0001', acknowledgedAt: null })]);
    expect(mine.requests[0]).toMatchObject({ status: 'FULFILLED', asset: { tag: 'AST-0001' } });
    expect((await post(other, `/assignments/${mine.assets[0].assignmentId}/acknowledge`)).status).toBe(404);
    expect((await post(report, `/assignments/${mine.assets[0].assignmentId}/acknowledge`)).body.data.assets[0].acknowledgedAt).not.toBeNull();

    // The manager sees what their people hold; others see nothing.
    const leadView = (await ctx.http().get(`${API}/assets`).set(lead.h)).body.data as { tag: string }[];
    expect(leadView.map((a) => a.tag)).toEqual(['AST-0001']);
    expect((await ctx.http().get(`${API}/assets`).set(other.h)).status).toBe(403);
    expect((await ctx.http().get(`${API}/assets/${monitor.id}`).set(lead.h)).status).toBe(404);

    // Can't retire an asset someone holds; returning it damaged sends it to repair.
    expect((await ctx.http().put(`${API}/assets/${laptop.body.data.id}/status`).set(hr.h).send({ status: 'RETIRED' })).status).toBe(409);
    const back = await post(hr, `/${laptop.body.data.id}/return`, { condition: 'DAMAGED', note: 'Cracked screen' });
    expect(back.body.data).toMatchObject({ status: 'IN_REPAIR', assignedTo: null, condition: 'DAMAGED' });
    expect(back.body.data.history[0]).toMatchObject({ conditionOut: 'NEW', conditionIn: 'DAMAGED', employee: { name: 'Pat Person' } });
    expect((await ctx.http().get(`${API}/assets/summary`).set(hr.h)).body.data).toMatchObject({ total: 2, inStock: 1, inRepair: 1, assigned: 0, pendingRequests: 0 });
  });

  it('runs a helpdesk ticket through the queue with internal notes, SLA and rating', async () => {
    const { person } = await setup();
    const agent = await person(['hr_manager']);
    const other = await person(['hr_manager']);
    const emp = await person(['employee']);
    const stranger = await person(['employee']);

    const raised = await ctx.http().post(`${API}/helpdesk/tickets`).set(emp.h).send({ category: 'PAYROLL', subject: 'Payslip shows wrong HRA', description: 'My October payslip is missing HRA.', priority: 'HIGH' });
    expect(raised.status).toBe(201);
    const t = raised.body.data;
    expect(t).toMatchObject({ reference: 'HD-0001', status: 'OPEN', priority: 'HIGH', overdue: false, permissions: { manage: false } });
    expect(new Date(t.dueAt).getTime() - new Date(t.createdAt).getTime()).toBe(24 * 3_600_000);
    expect(await Notification.count({ where: { userId: agent.user.id, type: 'helpdesk.ticket' }, ...RAW })).toBe(1);
    expect((await ctx.http().get(`${API}/helpdesk/tickets/${t.id}`).set(stranger.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/helpdesk/tickets?view=queue`).set(emp.h)).status).toBe(403);

    const reply = (who: { h: Record<string, string> }, body: Record<string, unknown>) => ctx.http().post(`${API}/helpdesk/tickets/${t.id}/messages`).set(who.h).send(body);
    expect((await reply(emp, { body: 'secret', internal: true })).status).toBe(403);
    await reply(agent, { body: 'Checking with payroll', internal: true });
    const answered = await reply(agent, { body: 'Fixed in the next run', status: 'WAITING' });
    expect(answered.body.data).toMatchObject({ status: 'WAITING', assignee: { name: 'Hari Person' } });
    expect(answered.body.data.firstResponseAt).not.toBeNull();
    const empView = (await ctx.http().get(`${API}/helpdesk/tickets/${t.id}`).set(emp.h)).body.data;
    expect(empView.messages.map((m: { body: string }) => m.body)).toEqual(['My October payslip is missing HRA.', 'Fixed in the next run']);
    expect((await reply(emp, { body: 'Thanks, will check' })).body.data.status).toBe('OPEN');

    expect((await ctx.http().patch(`${API}/helpdesk/tickets/${t.id}`).set(agent.h).send({ assigneeId: emp.user.id })).status).toBe(422);
    const moved = await ctx.http().patch(`${API}/helpdesk/tickets/${t.id}`).set(agent.h).send({ assigneeId: other.user.id, priority: 'LOW' });
    expect(moved.body.data).toMatchObject({ assignee: { name: 'Hari Person' }, priority: 'LOW' });
    expect(new Date(moved.body.data.dueAt).getTime() - new Date(t.createdAt).getTime()).toBe(120 * 3_600_000);
    expect(await Notification.count({ where: { userId: other.user.id, type: 'helpdesk.ticket', title: 'HD-0001 was assigned to you' }, ...RAW })).toBe(1);

    expect((await ctx.http().post(`${API}/helpdesk/tickets/${t.id}/rating`).set(emp.h).send({ rating: 5 })).status).toBe(409);
    await ctx.http().patch(`${API}/helpdesk/tickets/${t.id}`).set(other.h).send({ status: 'RESOLVED' });
    const rated = await ctx.http().post(`${API}/helpdesk/tickets/${t.id}/rating`).set(emp.h).send({ rating: 4, comment: 'Quick' });
    expect(rated.body.data).toMatchObject({ status: 'CLOSED', rating: 4 });
    expect((await reply(emp, { body: 'One more thing' })).status).toBe(409);

    const stats = (await ctx.http().get(`${API}/helpdesk/tickets/stats`).set(agent.h)).body.data;
    expect(stats).toMatchObject({ active: 0, resolvedLast30Days: 1, avgRating: 4, withinTargetPercent: 100 });

    // Agents see their own ticket as the employee; resolved tickets close by themselves after a week.
    const own = (await ctx.http().post(`${API}/helpdesk/tickets`).set(agent.h).send({ category: 'IT', subject: 'VPN access please', description: 'Need VPN for remote work' })).body.data;
    expect(own.permissions.manage).toBe(false);
    expect((await ctx.http().patch(`${API}/helpdesk/tickets/${own.id}`).set(agent.h).send({ status: 'RESOLVED' })).status).toBe(403);
    await ctx.http().patch(`${API}/helpdesk/tickets/${own.id}`).set(other.h).send({ status: 'RESOLVED' });
    await HelpdeskTicket.update({ resolvedAt: new Date(Date.now() - 8 * 24 * 3_600_000) }, { where: { id: own.id }, ...RAW });
    const listed = (await ctx.http().get(`${API}/helpdesk/tickets?view=queue`).set(other.h)).body.data as { id: string; status: string }[];
    expect(listed.find((x) => x.id === own.id)!.status).toBe('CLOSED');
  });

  it('routes travel to the manager, then the travel desk', async () => {
    const { person } = await setup();
    const desk = await person(['hr_manager']);
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    const other = await person(['employee']);
    const today = orgToday();
    const trip = (body: Record<string, unknown>) =>
      ctx
        .http()
        .post(`${API}/travel/requests`)
        .set(report.h)
        .send({ purpose: 'Client workshop', fromCity: 'Bengaluru', toCity: 'Mumbai', departureDate: addDays(today, 10), returnDate: addDays(today, 12), mode: 'FLIGHT', estimatedCost: 30000, ...body });

    expect((await trip({ departureDate: addDays(today, -1) })).status).toBe(422);
    expect((await trip({ advanceAmount: 40000 })).status).toBe(422);
    const created = await trip({ advanceAmount: 10000, needsAccommodation: true });
    expect(created.status).toBe(201);
    const r = created.body.data;
    expect(r).toMatchObject({ reference: 'TR-0001', status: 'PENDING', advanceAmount: 10000, permissions: { approve: false, cancel: true } });
    expect(await Notification.count({ where: { userId: lead.user.id, type: 'travel.request' }, ...RAW })).toBe(1);

    const team = (await ctx.http().get(`${API}/travel/requests?view=team`).set(lead.h)).body.data as { id: string; permissions: { approve: boolean } }[];
    expect(team).toEqual([expect.objectContaining({ id: r.id, permissions: expect.objectContaining({ approve: true }) })]);
    expect((await ctx.http().post(`${API}/travel/requests/${r.id}/approve`).set(other.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/travel/requests?view=all`).set(lead.h)).status).toBe(403);
    expect((await ctx.http().put(`${API}/travel/requests/${r.id}/desk`).set(desk.h).send({ bookingNotes: 'Flight 6E-123' })).status).toBe(409);

    const approved = await ctx.http().post(`${API}/travel/requests/${r.id}/approve`).set(lead.h).send({ note: 'Go ahead' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: 'Lena Person', reviewNote: 'Go ahead' });
    expect(await Notification.count({ where: { userId: desk.user.id, type: 'travel.desk' }, ...RAW })).toBe(1);

    const booked = await ctx.http().put(`${API}/travel/requests/${r.id}/desk`).set(desk.h).send({ bookingNotes: 'Flight 6E-123, Hotel Marine', advanceReference: 'UTR123' });
    expect(booked.body.data).toMatchObject({ bookingNotes: 'Flight 6E-123, Hotel Marine', advanceReference: 'UTR123', permissions: { complete: false } });
    expect(booked.body.data.advancePaidAt).not.toBeNull();
    expect((await ctx.http().put(`${API}/travel/requests/${r.id}/desk`).set(desk.h).send({ advanceReference: 'UTR999' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/travel/requests/${r.id}/complete`).set(report.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/travel/requests/${r.id}/cancel`).set(report.h).send({})).body.data.status).toBe('CANCELLED');
  });
});
