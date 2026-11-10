import { addDays, weekday } from '../src/common/utils/zoned-time';
import { CompOffRequest, LeaveLedgerEntry } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, orgToday, resetDatabase, uniqueEmail } from './helpers';

/** The latest day before `from` (inclusive) that is one of `days` (0 = Sunday). */
const latest = (from: string, days: number[]) => {
  let d = from;
  while (!days.includes(weekday(d))) d = addDays(d, -1);
  return d;
};

describe('Location holidays and comp-off (e2e)', () => {
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
    const location = async (name: string) => (await ctx.http().post(`${API}/locations`).set(h).send({ name })).body.data.id as string;
    const [blr, bom] = [await location('Bengaluru'), await location('Mumbai')];
    async function person(roleKeys: string[], extra: Record<string, unknown> = {}) {
      const user = await createUser(ctx, { email: uniqueEmail('p') });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx
        .http()
        .post(`${API}/employees`)
        .set(h)
        .send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2025-01-01', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      return { employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
    }
    return { h, blr, bom, person };
  }

  it('applies a holiday only at its locations and keeps one holiday per location and date', async () => {
    const { h, blr, bom, person } = await setup();
    const blrPerson = await person(['employee'], { locationId: blr });
    const bomPerson = await person(['employee'], { locationId: bom });
    const remote = await person(['employee']);
    const day = latest(addDays(orgToday(), -7), [1, 2, 3, 4, 5]);

    const rajyotsava = await ctx
      .http()
      .post(`${API}/holidays`)
      .set(h)
      .send({ date: day, name: 'Rajyotsava', locationIds: [blr] });
    expect(rajyotsava.status).toBe(201);
    expect(rajyotsava.body.data.locations).toEqual([{ id: blr, name: 'Bengaluru' }]);
    expect((await ctx.http().post(`${API}/holidays`).set(h).send({ date: day, name: 'Company day' })).status).toBe(422);
    expect(
      (
        await ctx
          .http()
          .post(`${API}/holidays`)
          .set(h)
          .send({ date: day, name: 'Again', locationIds: [blr, bom] })
      ).status,
    ).toBe(422);
    expect(
      (
        await ctx
          .http()
          .post(`${API}/holidays`)
          .set(h)
          .send({ date: day, name: 'Gudi Padwa', locationIds: [bom] })
      ).status,
    ).toBe(201);
    expect(
      (
        await ctx
          .http()
          .post(`${API}/holidays`)
          .set(h)
          .send({ date: day, name: 'Nowhere', locationIds: ['00000000-0000-4000-8000-000000000000'] })
      ).status,
    ).toBe(422);

    const statusOn = async (employeeId: string) => {
      const cal = (
        await ctx
          .http()
          .get(`${API}/attendance/calendar?month=${day.slice(0, 7)}&employeeId=${employeeId}`)
          .set(h)
      ).body.data;
      return cal.days.find((d: { date: string }) => d.date === day);
    };
    expect(await statusOn(blrPerson.employee.id)).toMatchObject({ status: 'HOLIDAY', holiday: { name: 'Rajyotsava' } });
    expect(await statusOn(bomPerson.employee.id)).toMatchObject({ status: 'HOLIDAY', holiday: { name: 'Gudi Padwa' } });
    expect((await statusOn(remote.employee.id)).holiday).toBeNull();

    const year = Number(day.slice(0, 4));
    const list = (await ctx.http().get(`${API}/holidays?year=${year}`).set(h)).body.data as { name: string; locations: { name: string }[] }[];
    expect(
      list
        .filter((x) => x.name === 'Rajyotsava' || x.name === 'Gudi Padwa')
        .map((x) => x.locations[0]!.name)
        .sort(),
    ).toEqual(['Bengaluru', 'Mumbai']);
  });

  it('credits comp-off for working on a day off once approved, and lets it expire', async () => {
    const { h, blr, person } = await setup();
    const lead = await person(['team_lead']);
    const me = await person(['employee'], { locationId: blr, managerId: lead.employee.id });
    const types = (await ctx.http().post(`${API}/leave/types/recommended`).set(h)).body.data.types as { id: string; code: string; compOffValidityDays: number | null }[];
    const co = types.find((t) => t.code === 'CO')!;
    expect(co.compOffValidityDays).toBe(90);
    expect((await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'CO2', name: 'Second comp-off', accrualFrequency: 'NONE', compOffValidityDays: 30 })).status).toBe(422);

    const today = orgToday();
    const holiday = latest(addDays(today, -7), [1, 2, 3, 4, 5]);
    const saturday = latest(addDays(today, -1), [6]);
    const workday = latest(addDays(holiday, -1), [1, 2, 3, 4, 5]);
    await ctx
      .http()
      .post(`${API}/holidays`)
      .set(h)
      .send({ date: holiday, name: 'Rajyotsava', locationIds: [blr] });
    const put = (workDate: string, checkIn: string, checkOut: string) =>
      ctx.http().put(`${API}/attendance/records`).set(h).send({ employeeId: me.employee.id, workDate, checkIn, checkOut, note: 'Worked' });
    expect((await put(holiday, '09:00', '18:00')).status).toBe(200);
    expect((await put(saturday, '09:00', '13:30')).status).toBe(200);
    expect((await put(workday, '09:00', '18:00')).status).toBe(200);

    const eligible = (await ctx.http().get(`${API}/leave/comp-offs/eligible`).set(me.h)).body.data;
    expect(eligible).toMatchObject({ enabled: true, leaveType: { code: 'CO', validityDays: 90 } });
    expect(eligible.days.find((d: { date: string }) => d.date === holiday)).toMatchObject({ kind: 'HOLIDAY', label: 'Rajyotsava', maxDays: 1, request: null });
    expect(eligible.days.find((d: { date: string }) => d.date === saturday)).toMatchObject({ kind: 'WEEKLY_OFF', maxDays: 0.5 });
    expect(eligible.days.some((d: { date: string }) => d.date === workday)).toBe(false);

    const ask = (workDate: string, days: number) => ctx.http().post(`${API}/leave/comp-offs`).set(me.h).send({ workDate, days, reason: 'Release support' });
    expect((await ask(workday, 1)).status).toBe(422);
    expect((await ask(saturday, 1)).status).toBe(422);
    const half = await ask(saturday, 0.5);
    expect(half.status).toBe(201);
    const full = await ask(holiday, 1);
    expect(full.status).toBe(201);
    expect(full.body.data).toMatchObject({ status: 'PENDING', dayKind: 'HOLIDAY', dayLabel: 'Rajyotsava', days: 1 });
    expect((await ask(holiday, 1)).status).toBe(409);

    expect((await ctx.http().post(`${API}/leave/comp-offs/${full.body.data.id}/approve`).set(me.h).send({})).status).toBe(403);
    const team = (await ctx.http().get(`${API}/leave/comp-offs?view=team`).set(lead.h)).body.data;
    expect(team).toHaveLength(2);
    const approved = await ctx.http().post(`${API}/leave/comp-offs/${full.body.data.id}/approve`).set(lead.h).send({});
    expect(approved.status).toBe(201);
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', expiresOn: addDays(holiday, 90) });
    expect((await ctx.http().post(`${API}/leave/comp-offs/${half.body.data.id}/approve`).set(lead.h).send({})).status).toBe(201);

    const balance = async () => {
      const res = await ctx.http().get(`${API}/leave/balances`).set(me.h);
      return (res.body.data.balances as { leaveType: { code: string }; balance: number; granted: number }[]).find((b) => b.leaveType.code === 'CO')!;
    };
    expect(await balance()).toMatchObject({ balance: 1.5, granted: 1.5 });

    // The half day's credit runs out: only the still-valid day remains.
    await CompOffRequest.update({ expiresOn: addDays(today, -1) }, { where: { id: half.body.data.id }, ...RAW });
    expect((await balance()).balance).toBe(1);
    expect((await balance()).balance).toBe(1);
    const lapses = await LeaveLedgerEntry.findAll({ where: { employeeId: me.employee.id, leaveTypeId: co.id, kind: 'LAPSE' }, ...RAW });
    expect(lapses.map((l) => Number(l.days))).toEqual([-0.5]);

    const mine = (await ctx.http().get(`${API}/leave/comp-offs`).set(me.h)).body.data as { status: string }[];
    expect(mine.map((r) => r.status)).toEqual(['APPROVED', 'APPROVED']);
  });
});
