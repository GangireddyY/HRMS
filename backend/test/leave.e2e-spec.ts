import { addDays, weekday, zonedParts } from '../src/common/utils/zoned-time';
import { LeaveLedgerEntry, Notification, Organization } from '../src/database/models';
import { accrualPlan, leaveYearOf } from '../src/modules/leave/leave-policy';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

/** Next weekday (Mon–Fri) on or after `date`. */
const workday = (date: string) => {
  let d = date;
  while ([0, 6].includes(weekday(d))) d = addDays(d, 1);
  return d;
};
/** The Monday at least `minDays` days after `date`. */
const mondayAfter = (date: string, minDays: number) => {
  let d = addDays(date, minDays);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
};
const lastWorkdayBefore = (date: string) => {
  let d = addDays(date, -1);
  while ([0, 6].includes(weekday(d))) d = addDays(d, -1);
  return d;
};

describe('Leave (e2e)', () => {
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

  /** An organization whose leave year started about six months ago, so tests have room on both sides of today. */
  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const tz = (await Organization.findByPk(org.organization.id))!.timezone;
    const today = zonedParts(new Date(), tz).date;
    const startMonth = ((Number(today.slice(5, 7)) + 5) % 12) + 1;
    expect((await ctx.http().put(`${API}/leave/settings`).set(h).send({ leaveYearStartMonth: startMonth })).status).toBe(200);
    const year = leaveYearOf(today, startMonth);
    const types = (await ctx.http().post(`${API}/leave/types/recommended`).set(h)).body.data.types as { id: string; code: string }[];
    const type = (code: string) => types.find((t) => t.code === code)!;
    return { ...org, h, today, startMonth, year, type };
  }

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p') });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2020-01-06', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  const balanceOf = async (h: Record<string, string>, code: string, employeeId?: string) => {
    const res = await ctx.http().get(`${API}/leave/balances${employeeId ? `?employeeId=${employeeId}` : ''}`).set(h);
    expect(res.status).toBe(200);
    return (res.body.data.balances as { leaveType: { code: string }; balance: number | null; available: number | null; pending: number; taken: number; opening: number; accrued: number }[]).find((b) => b.leaveType.code === code)!;
  };

  it('configures leave types and the leave year', async () => {
    const { h, type } = await setup();
    expect(type('CL')).toBeDefined();
    expect((await ctx.http().post(`${API}/leave/types/recommended`).set(h)).body.data.added).toBe(0);
    expect((await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'cl', name: 'Another' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'ML', name: 'Maternity leave', accrualFrequency: 'YEARLY' })).status).toBe(422);
    const ml = await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'ml', name: 'Maternity leave', accrualFrequency: 'NONE', applicableGender: 'FEMALE', countNonWorkingDays: true, color: '#d946ef' });
    expect(ml.body.data).toMatchObject({ code: 'ML', applicableGender: 'FEMALE', unlimited: false });
    expect((await ctx.http().patch(`${API}/leave/types/${ml.body.data.id}`).set(h).send({ maxConsecutiveDays: 182 })).body.data.maxConsecutiveDays).toBe(182);
    expect((await ctx.http().delete(`${API}/leave/types/${ml.body.data.id}`).set(h)).status).toBe(200);

    // Once balances exist, the leave year is fixed.
    await balanceOf(h, 'CL', (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'A', lastName: 'B', dateOfJoining: '2020-01-06' })).body.data.id);
    expect((await ctx.http().put(`${API}/leave/settings`).set(h).send({ leaveYearStartMonth: 1 })).status).toBe(409);
  });

  it('accrues balances idempotently and carries forward at year end', async () => {
    const { h, today, startMonth, year } = await setup();
    const joined = `${year - 1}-${String(startMonth).padStart(2, '0')}-01`;
    const e = (await ctx.http().post(`${API}/employees`).set(h).send({ firstName: 'Asha', lastName: 'Rao', dateOfJoining: joined })).body.data;

    const cl = await balanceOf(h, 'CL', e.id);
    const el = await balanceOf(h, 'EL', e.id);
    const expectedEl = accrualPlan({ id: 'x', annualQuota: 15, accrualFrequency: 'MONTHLY', prorateOnJoining: true }, { id: 'x', dateOfJoining: joined, exitDate: null }, year, startMonth, today).reduce((n, p) => n + p.days, 0);
    // CL: 12 this year, last year's 12 lapsed (no carry-forward). EL: last year's 15 carried forward (limit 30) + this year's monthly accruals.
    expect(cl).toMatchObject({ opening: 0, accrued: 12, balance: 12 });
    expect(el.opening).toBe(15);
    expect(el.accrued).toBeCloseTo(expectedEl, 2);
    expect((await balanceOf(h, 'LOP', e.id)).balance).toBeNull();

    const count = await LeaveLedgerEntry.count({ where: { employeeId: e.id }, ...RAW });
    await balanceOf(h, 'CL', e.id);
    expect((await ctx.http().post(`${API}/leave/accruals/run`).set(h)).body.data.entries).toBe(0);
    expect(await LeaveLedgerEntry.count({ where: { employeeId: e.id }, ...RAW })).toBe(count);

    const prev = (await ctx.http().get(`${API}/leave/ledger?employeeId=${e.id}&year=${year - 1}`).set(h)).body.data as { kind: string; days: number; leaveType: { code: string } }[];
    expect(prev.find((x) => x.kind === 'LAPSE' && x.leaveType.code === 'CL')?.days).toBe(-12);
  });

  it('applies, approves and cancels leave with balance, overlap and notice rules', async () => {
    const { organization, h, today, type } = await setup();
    const lead = await person(organization.id, h, ['team_lead']);
    const me = await person(organization.id, h, ['employee'], { managerId: lead.employee.id });
    const monday = mondayAfter(today, 2);
    const wednesday = addDays(monday, 2);

    const quote = await ctx.http().post(`${API}/leave/requests/quote`).set(me.h).send({ leaveTypeId: type('CL').id, startDate: monday, endDate: addDays(monday, 6) });
    // Mon–Sun with a weekend: 5 working days, more than CL's 3 consecutive days.
    expect(quote.body.data).toMatchObject({ days: 5, available: 12 });
    expect(quote.body.data.issues.map((i: { message: string }) => i.message).join(' ')).toContain('at most 3 days');

    const applied = await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('CL').id, startDate: monday, endDate: wednesday, reason: 'Family function' });
    expect(applied.status).toBe(201);
    expect(applied.body.data).toMatchObject({ days: 3, status: 'PENDING' });
    expect(await Notification.count({ where: { userId: lead.user.id, type: 'leave.request' } })).toBe(1);
    expect(await balanceOf(me.h, 'CL')).toMatchObject({ balance: 12, pending: 3, available: 9 });

    // Overlaps and notice.
    expect((await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('SL').id, startDate: wednesday, endDate: wednesday, reason: 'Clash' })).status).toBe(422);
    const earlyEl = await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('EL').id, startDate: workday(addDays(today, 1)), endDate: workday(addDays(today, 1)), reason: 'Too soon' });
    expect(earlyEl.status).toBe(422);
    expect(earlyEl.body.error.details[0].message).toContain('notice');
    // Half days: morning and afternoon of the same day can coexist; EL has no half days.
    const friday = addDays(monday, 4);
    expect((await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('SL').id, startDate: friday, endDate: friday, startSession: 'FIRST_HALF', reason: 'Doctor' })).body.data.days).toBe(0.5);
    expect((await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('CL').id, startDate: friday, endDate: friday, startSession: 'SECOND_HALF', reason: 'Errand' })).status).toBe(201);

    // Review: not your own; team lead approves; balance moves from pending to taken.
    expect((await ctx.http().post(`${API}/leave/requests/${applied.body.data.id}/approve`).set(me.h).send({})).status).toBe(403);
    const team = await ctx.http().get(`${API}/leave/requests?view=team&status=PENDING`).set(lead.h);
    expect(team.body.data.map((r: { id: string }) => r.id)).toContain(applied.body.data.id);
    const approved = await ctx.http().post(`${API}/leave/requests/${applied.body.data.id}/approve`).set(lead.h).send({ note: 'Enjoy' });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    expect(await balanceOf(me.h, 'CL')).toMatchObject({ balance: 9, taken: 3, pending: 0.5, available: 8.5 });
    expect(await Notification.count({ where: { userId: me.user.id, type: 'leave.request' } })).toBe(1);

    // The attendance calendar shows the days as leave.
    const cal = await ctx.http().get(`${API}/attendance/calendar?month=${monday.slice(0, 7)}`).set(me.h);
    expect(cal.body.data.days.find((d: { date: string }) => d.date === monday)).toMatchObject({ status: 'ON_LEAVE', leave: { code: 'CL', session: 'FULL' } });

    // Rejection needs a reason; the employee cancels approved future leave and gets the days back.
    const pendingSl = (await ctx.http().get(`${API}/leave/requests?view=team&status=PENDING`).set(lead.h)).body.data.find((r: { leaveType: { code: string } }) => r.leaveType.code === 'SL');
    expect((await ctx.http().post(`${API}/leave/requests/${pendingSl.id}/reject`).set(lead.h).send({})).status).toBe(422);
    expect((await ctx.http().post(`${API}/leave/requests/${pendingSl.id}/reject`).set(lead.h).send({ note: 'Please apply as CL' })).body.data.status).toBe('REJECTED');
    const cancelled = await ctx.http().post(`${API}/leave/requests/${applied.body.data.id}/cancel`).set(me.h).send({});
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await balanceOf(me.h, 'CL')).toMatchObject({ balance: 12, taken: 0 });
    const ledger = (await ctx.http().get(`${API}/leave/ledger`).set(me.h)).body.data.map((x: { kind: string }) => x.kind);
    expect(ledger).toEqual(expect.arrayContaining(['ACCRUAL', 'TAKEN', 'REVERSAL']));
  });

  it('blocks over-balance requests, handles back-dated leave in the register and closed months', async () => {
    const { organization, h, today, type } = await setup();
    const me = await person(organization.id, h, ['employee']);
    // A small balance makes the limit easy to hit.
    const small = (await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'BL', name: 'Birthday leave', annualQuota: 1, accrualFrequency: 'YEARLY', maxBackdatedDays: 30, allowHalfDay: false })).body.data;
    const monday = mondayAfter(today, 1);
    const over = await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: small.id, startDate: monday, endDate: addDays(monday, 1), reason: 'Two days' });
    expect(over.status).toBe(422);
    expect(over.body.error.details[0].message).toContain('Not enough');

    // Back-dated sick leave, approved by HR, shows as leave in the daily register.
    const past = lastWorkdayBefore(today);
    const sl = (await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: type('SL').id, startDate: past, endDate: past, reason: 'Fever' })).body.data;
    expect((await ctx.http().post(`${API}/leave/requests/${sl.id}/approve`).set(h).send({})).body.data.status).toBe('APPROVED');
    const daily = (await ctx.http().get(`${API}/attendance/daily?date=${past}`).set(h)).body.data;
    expect(daily.summary.onLeave).toBe(1);
    expect(daily.page.items.find((r: { employee: { id: string } }) => r.employee.id === me.employee.id)).toMatchObject({ status: 'ON_LEAVE' });

    // Closing a month locks leave changes in it.
    const lastMonth = lastWorkdayBefore(`${today.slice(0, 7)}-01`);
    const late = (await ctx.http().post(`${API}/leave/types`).set(h).send({ code: 'XO', name: 'Extra off', annualQuota: 5, accrualFrequency: 'YEARLY', maxBackdatedDays: 90 })).body.data;
    const co = (await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: late.id, startDate: lastMonth, endDate: lastMonth, reason: 'Worked on Sunday' })).body.data;
    expect((await ctx.http().post(`${API}/leave/requests/${co.id}/approve`).set(h).send({})).status).toBe(201);
    const [y, m] = lastMonth.split('-').map(Number);
    expect((await ctx.http().post(`${API}/attendance/periods/${y}/${m}/close`).set(h)).status).toBe(201);
    expect((await ctx.http().post(`${API}/leave/requests/${co.id}/cancel`).set(h).send({ reason: 'Mistake' })).status).toBe(409);
    const blocked = await ctx.http().post(`${API}/leave/requests`).set(me.h).send({ leaveTypeId: late.id, startDate: lastWorkdayBefore(lastMonth), endDate: lastWorkdayBefore(lastMonth), reason: 'Late' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body.error.details)).toContain('is closed');
  });

  it('lets HR grant, adjust and encash within the rules', async () => {
    const { organization, h, type } = await setup();
    const me = await person(organization.id, h, ['employee']);
    const grant = await ctx.http().post(`${API}/leave/adjustments`).set(h).send({ employeeId: me.employee.id, leaveTypeId: type('CL').id, kind: 'GRANT', days: 2, note: 'Weekend support' });
    expect(grant.status).toBe(201);
    expect((await balanceOf(me.h, 'CL')).balance).toBe(14);
    expect(await Notification.count({ where: { userId: me.user.id, type: 'leave.balance' } })).toBe(1);
    expect((await ctx.http().post(`${API}/leave/adjustments`).set(h).send({ employeeId: me.employee.id, leaveTypeId: type('CL').id, kind: 'ENCASHMENT', days: 1, note: 'x' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/leave/adjustments`).set(h).send({ employeeId: me.employee.id, leaveTypeId: type('CL').id, kind: 'ADJUSTMENT', days: -20, note: 'Too much' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/leave/adjustments`).set(h).send({ employeeId: me.employee.id, leaveTypeId: type('CL').id, kind: 'GRANT', days: 0.25, note: 'Odd' })).status).toBe(422);
    const el = await balanceOf(me.h, 'EL');
    if (el.available! >= 1) {
      expect((await ctx.http().post(`${API}/leave/adjustments`).set(h).send({ employeeId: me.employee.id, leaveTypeId: type('EL').id, kind: 'ENCASHMENT', days: 1, note: 'Year-end encashment' })).status).toBe(201);
      expect((await balanceOf(me.h, 'EL')).balance).toBeCloseTo(el.balance! - 1, 2);
    }
    expect((await ctx.http().post(`${API}/leave/adjustments`).set(me.h).send({ employeeId: me.employee.id, leaveTypeId: type('CL').id, kind: 'GRANT', days: 5, note: 'Self' })).status).toBe(403);
  });

  it('keeps leave within scope and isolated between organizations', async () => {
    const { organization, h, today, type } = await setup();
    const lead = await person(organization.id, h, ['team_lead']);
    const mine = await person(organization.id, h, ['employee'], { managerId: lead.employee.id });
    const other = await person(organization.id, h, ['employee']);
    const monday = mondayAfter(today, 2);
    await ctx.http().post(`${API}/leave/requests`).set(mine.h).send({ leaveTypeId: type('CL').id, startDate: monday, endDate: monday, reason: 'Team' });
    const outsider = (await ctx.http().post(`${API}/leave/requests`).set(other.h).send({ leaveTypeId: type('CL').id, startDate: monday, endDate: monday, reason: 'Other team' })).body.data;

    const cal = (await ctx.http().get(`${API}/leave/calendar?month=${monday.slice(0, 7)}`).set(lead.h)).body.data;
    expect(cal.entries.map((e: { employee: { id: string } }) => e.employee.id)).toEqual([mine.employee.id]);
    expect((await ctx.http().post(`${API}/leave/requests/${outsider.id}/approve`).set(lead.h).send({})).status).toBe(404);
    expect((await ctx.http().get(`${API}/leave/balances?employeeId=${other.employee.id}`).set(mine.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/leave/calendar?month=${monday.slice(0, 7)}`).set(h)).body.data.entries).toHaveLength(2);

    const b = await createOrgWithAdmin(ctx);
    const hb = bearer((await login(ctx, b.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/leave/types`).set(hb)).body.data).toEqual([]);
    expect((await ctx.http().post(`${API}/leave/requests/${outsider.id}/approve`).set(hb).send({})).status).toBe(404);
    expect((await ctx.http().get(`${API}/leave/balances?employeeId=${mine.employee.id}`).set(hb)).status).toBe(404);
  });
});
