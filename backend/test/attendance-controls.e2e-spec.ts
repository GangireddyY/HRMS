import { Notification, ShiftAssignment } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** A tiny JPEG (only the start-of-image marker matters to the server). */
const JPEG = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]).toString('base64')}`;

describe('Attendance controls: office networks, punch photos and shift swaps (e2e)', () => {
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
    async function person(roleKeys: string[], firstName: string, extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    return { ...org, h, person };
  }

  it('accepts web punch-ins only from the office network', async () => {
    const { h, person } = await setup();
    const office = (await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Pune office', allowedNetworks: ['10.20.0.0/16'] })).body.data;
    expect(office.allowedNetworks).toEqual(['10.20.0.0/16']);
    expect((await ctx.http().patch(`${API}/locations/${office.id}`).set(h).send({ allowedNetworks: ['office wifi'] })).status).toBe(422);
    const asha = await person(['employee'], 'Asha', { locationId: office.id });

    expect((await ctx.http().get(`${API}/attendance/today`).set(asha.h)).body.data.officeNetwork).toEqual({ location: 'Pune office', onNetwork: false });
    const refused = await ctx.http().post(`${API}/attendance/punch-in`).set(asha.h).send({});
    expect(refused.status).toBe(422);
    expect(refused.body.error.details[0].message).toMatch(/Pune office office network/);

    await ctx.http().patch(`${API}/locations/${office.id}`).set(h).send({ allowedNetworks: ['10.20.0.0/16', '127.0.0.1', '::1'] });
    expect((await ctx.http().get(`${API}/attendance/today`).set(asha.h)).body.data.officeNetwork).toEqual({ location: 'Pune office', onNetwork: true });
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(asha.h).send({})).body.data.record).toMatchObject({ workMode: 'OFFICE', hasPhoto: false });
  });

  it('asks for a photo with every punch-in where the location requires it', async () => {
    const { h, person } = await setup();
    const site = (await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Field site', punchPhotoRequired: true })).body.data;
    const lead = await person(['team_lead'], 'Lalit');
    const ben = await person(['employee'], 'Ben', { locationId: site.id, managerId: lead.employee.id });

    expect((await ctx.http().get(`${API}/attendance/today`).set(ben.h)).body.data.photoRequired).toBe(true);
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(ben.h).send({})).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(ben.h).send({ photo: 'data:image/gif;base64,R0lGOD' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(ben.h).send({ photo: `data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}` })).status).toBe(422);
    const ok = await ctx.http().post(`${API}/attendance/punch-in`).set(ben.h).send({ photo: JPEG });
    expect(ok.body.data.record).toMatchObject({ hasPhoto: true });

    const recordId = ok.body.data.record.id;
    const own = await ctx.http().get(`${API}/attendance/records/${recordId}/photo`).set(ben.h);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/jpeg');
    expect((await ctx.http().get(`${API}/attendance/records/${recordId}/photo`).set(lead.h)).status).toBe(200);
    const stranger = await person(['employee'], 'Sara');
    expect((await ctx.http().get(`${API}/attendance/records/${recordId}/photo`).set(stranger.h)).status).toBe(404);
  });

  it('swaps shifts once the colleague agrees and the manager approves', async () => {
    const { h, person } = await setup();
    const morning = (await ctx.http().post(`${API}/attendance/shifts`).set(h).send({ name: 'Morning', startTime: '06:00', endTime: '14:00', weeklyOffs: [] })).body.data;
    const evening = (await ctx.http().post(`${API}/attendance/shifts`).set(h).send({ name: 'Evening', startTime: '14:00', endTime: '22:00', weeklyOffs: [] })).body.data;
    const lead = await person(['team_lead'], 'Lalit');
    const asha = await person(['employee'], 'Asha', { managerId: lead.employee.id, shiftId: morning.id });
    const ben = await person(['employee'], 'Ben', { managerId: lead.employee.id, shiftId: evening.id });
    const cara = await person(['employee'], 'Cara', { managerId: lead.employee.id, shiftId: morning.id });
    const day = addDays(istToday(), 3);
    const ask = (who: { h: Record<string, string> }, colleagueId: string, workDate = day) => ctx.http().post(`${API}/attendance/shift-swaps`).set(who.h).send({ colleagueId, workDate, reason: 'Doctor appointment in the morning' });

    expect((await ask(asha, cara.employee.id)).status).toBe(422);
    expect((await ask(asha, ben.employee.id, istToday())).status).toBe(422);
    const asked = await ask(asha, ben.employee.id);
    expect(asked.status).toBe(201);
    const swap = asked.body.data;
    expect(swap).toMatchObject({ status: 'ASKED', requester: { name: 'Asha Person', shift: { name: 'Morning' } }, colleague: { name: 'Ben Person', shift: { name: 'Evening' } }, permissions: { cancel: true } });
    expect((await ask(cara, ben.employee.id)).status).toBe(409);
    expect(await Notification.count({ where: { userId: ben.user.id, type: 'attendance.swap' }, ...RAW })).toBe(1);

    expect((await ctx.http().post(`${API}/attendance/shift-swaps/${swap.id}/approve`).set(lead.h).send({})).status).toBe(409);
    expect((await ctx.http().post(`${API}/attendance/shift-swaps/${swap.id}/respond`).set(asha.h).send({ accept: true })).status).toBe(404);
    const accepted = await ctx.http().post(`${API}/attendance/shift-swaps/${swap.id}/respond`).set(ben.h).send({ accept: true, note: 'Happy to' });
    expect(accepted.body.data).toMatchObject({ status: 'PENDING', colleagueNote: 'Happy to' });
    expect(await Notification.count({ where: { userId: lead.user.id, type: 'attendance.swap' }, ...RAW })).toBe(1);

    const team = (await ctx.http().get(`${API}/attendance/shift-swaps?view=team`).set(lead.h)).body.data as { id: string; permissions: { review: boolean } }[];
    expect(team).toEqual([expect.objectContaining({ id: swap.id, permissions: expect.objectContaining({ review: true }) })]);
    expect((await ctx.http().post(`${API}/attendance/shift-swaps/${swap.id}/reject`).set(lead.h).send({})).status).toBe(422);
    const approved = await ctx.http().post(`${API}/attendance/shift-swaps/${swap.id}/approve`).set(lead.h).send({ note: 'OK' });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: 'Lalit Person' });
    const rostered = await ShiftAssignment.findAll({ where: { startDate: day, endDate: day }, ...RAW });
    expect(rostered.map((r) => [r.employeeId, r.shiftId]).sort()).toEqual([[asha.employee.id, evening.id], [ben.employee.id, morning.id]].sort());
    expect((await ctx.http().get(`${API}/attendance/shift-swaps`).set(asha.h)).body.data[0].permissions.cancel).toBe(false);
  });
});
