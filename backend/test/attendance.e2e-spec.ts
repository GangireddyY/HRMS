import { AttendanceRecord, Notification } from '../src/database/models';
import { addDays, zonedParts } from '../src/common/utils/zoned-time';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Attendance (e2e)', () => {
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
      const user = await createUser(ctx, { email: uniqueEmail('p') });
      const membership = await addMember(ctx, org.organization.id, user.id, roleKeys);
      const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName: user.firstName, lastName: 'Person', dateOfJoining: '2025-01-01', membershipId: membership.id, ...extra });
      expect(res.status).toBe(201);
      const session = await login(ctx, user.email);
      return { employee: res.body.data, user, h: bearer(session.accessToken) };
    }
    return { ...org, h, person };
  }

  const today = () => zonedParts(new Date(), 'Asia/Kolkata').date;

  it('punches in and out once per day', async () => {
    const { person } = await setup();
    const emp = await person(['employee']);

    expect((await ctx.http().post(`${API}/attendance/punch-out`).set(emp.h)).status).toBe(409);
    const inRes = await ctx.http().post(`${API}/attendance/punch-in`).set(emp.h).send({ latitude: 12.97, longitude: 77.59 });
    expect(inRes.status).toBe(201);
    expect(inRes.body.data.openRecord.checkInAt).toBeTruthy();
    expect(inRes.body.data.shift).toMatchObject({ startTime: '09:00', endTime: '18:00' });
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(emp.h)).status).toBe(409);

    const outRes = await ctx.http().post(`${API}/attendance/punch-out`).set(emp.h);
    expect(outRes.status).toBe(201);
    expect(outRes.body.data.openRecord).toBeNull();
    expect(outRes.body.data.record).toMatchObject({ source: 'WEB', status: 'ABSENT', workedMinutes: 0 });
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(emp.h)).status).toBe(409);

    const row = await AttendanceRecord.findOne({ where: { employeeId: emp.employee.id }, ...RAW });
    expect(row!.checkInIp).toBeTruthy();
    expect(Number(row!.checkInLatitude)).toBeCloseTo(12.97);
  });

  it('builds the month calendar from records, holidays and weekly offs', async () => {
    const { h, person } = await setup();
    const emp = await person(['employee']);
    const put = (workDate: string, checkIn: string, checkOut: string | null) =>
      ctx.http().put(`${API}/attendance/records`).set(h).send({ employeeId: emp.employee.id, workDate, checkIn, checkOut, note: 'Imported from register' });

    expect((await put('2025-03-03', '09:05', '18:10')).body.data).toMatchObject({ status: 'PRESENT', lateMinutes: 0, source: 'MANUAL' });
    expect((await put('2025-03-04', '09:40', '14:00')).body.data).toMatchObject({ status: 'HALF_DAY', lateMinutes: 40, workedMinutes: 260 });
    expect((await put('2025-03-07', '09:00', null)).status).toBe(200);
    expect((await ctx.http().post(`${API}/holidays`).set(h).send({ date: '2025-03-05', name: 'Founders day' })).status).toBe(201);
    expect((await ctx.http().post(`${API}/holidays`).set(h).send({ date: '2025-03-05', name: 'Duplicate' })).status).toBe(422);
    expect((await put('2024-12-31', '09:00', '18:00')).status).toBe(422);

    const cal = (await ctx.http().get(`${API}/attendance/calendar?month=2025-03&employeeId=${emp.employee.id}`).set(h)).body.data;
    const day = (d: string) => cal.days.find((x: { date: string }) => x.date === d);
    expect(day('2025-03-01').status).toBe('WEEKLY_OFF');
    expect(day('2025-03-03').status).toBe('PRESENT');
    expect(day('2025-03-04').status).toBe('HALF_DAY');
    expect(day('2025-03-05')).toMatchObject({ status: 'HOLIDAY', holiday: { name: 'Founders day' } });
    expect(day('2025-03-06').status).toBe('ABSENT');
    expect(day('2025-03-07').status).toBe('MISSED_PUNCH');
    expect(cal.summary).toMatchObject({ present: 1, halfDay: 1, holidays: 1, missedPunch: 1, lateDays: 1, weeklyOffs: 10 });

    // The employee sees their own calendar without an id.
    expect((await ctx.http().get(`${API}/attendance/calendar?month=2025-03`).set(emp.h)).body.data.employee.id).toBe(emp.employee.id);

    const daily = (await ctx.http().get(`${API}/attendance/daily?date=2025-03-04`).set(h)).body.data;
    expect(daily.summary).toMatchObject({ halfDay: 1, late: 1 });
    expect(daily.page.items.find((r: { employee: { id: string } }) => r.employee.id === emp.employee.id).status).toBe('HALF_DAY');
  });

  it('limits attendance to the caller’s scope', async () => {
    const { person } = await setup();
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    const other = await person(['employee']);

    expect((await ctx.http().get(`${API}/attendance/calendar?month=2025-03&employeeId=${report.employee.id}`).set(lead.h)).status).toBe(200);
    expect((await ctx.http().get(`${API}/attendance/calendar?month=2025-03&employeeId=${other.employee.id}`).set(lead.h)).status).toBe(404);
    expect((await ctx.http().get(`${API}/attendance/calendar?month=2025-03&employeeId=${lead.employee.id}`).set(report.h)).status).toBe(404);
    expect((await ctx.http().put(`${API}/attendance/records`).set(report.h).send({ employeeId: report.employee.id, workDate: '2025-03-03', checkIn: '09:00', checkOut: '18:00', note: 'Self edit' })).status).toBe(403);

    const daily = (await ctx.http().get(`${API}/attendance/daily?date=2025-03-04`).set(lead.h)).body.data;
    expect(daily.page.items.map((r: { employee: { id: string } }) => r.employee.id).sort()).toEqual([lead.employee.id, report.employee.id].sort());
  });

  it('routes regularization requests to the manager for approval', async () => {
    const { person } = await setup();
    const lead = await person(['team_lead']);
    const report = await person(['employee'], { managerId: lead.employee.id });
    const workDate = addDays(today(), -3);

    expect((await ctx.http().post(`${API}/attendance/regularizations`).set(report.h).send({ workDate: addDays(today(), 2), checkIn: '09:00', checkOut: '18:00', reason: 'Future date' })).status).toBe(422);
    const created = await ctx.http().post(`${API}/attendance/regularizations`).set(report.h).send({ workDate, checkIn: '09:10', checkOut: '18:20', reason: 'Forgot to punch in' });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('PENDING');
    expect((await ctx.http().post(`${API}/attendance/regularizations`).set(report.h).send({ workDate, checkIn: '09:10', checkOut: '18:20', reason: 'Again please' })).status).toBe(409);
    expect(await Notification.count({ where: { userId: lead.user.id, type: 'attendance.regularization' } })).toBe(1);

    // The lead's own request never shows up in their review list, and they can't approve it.
    const own = (await ctx.http().post(`${API}/attendance/regularizations`).set(lead.h).send({ workDate, checkIn: '09:00', checkOut: '18:00', reason: 'My own day' })).body.data;
    const team = (await ctx.http().get(`${API}/attendance/regularizations?view=team&status=PENDING`).set(lead.h)).body.data;
    expect(team.map((r: { id: string }) => r.id)).toEqual([created.body.data.id]);
    expect((await ctx.http().post(`${API}/attendance/regularizations/${own.id}/approve`).set(lead.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/attendance/regularizations/${created.body.data.id}/approve`).set(report.h).send({})).status).toBe(403);

    const approved = await ctx.http().post(`${API}/attendance/regularizations/${created.body.data.id}/approve`).set(lead.h).send({ note: 'OK' });
    expect(approved.body.data).toMatchObject({ status: 'APPROVED', reviewNote: 'OK' });
    const record = await AttendanceRecord.findOne({ where: { employeeId: report.employee.id, workDate }, ...RAW });
    expect(record).toMatchObject({ source: 'REGULARIZED', workedMinutes: 550, status: 'PRESENT' });
    expect(await Notification.count({ where: { userId: report.user.id, type: 'attendance.regularization' } })).toBe(1);

    const mine = (await ctx.http().get(`${API}/attendance/regularizations?view=mine`).set(report.h)).body.data;
    expect(mine[0]).toMatchObject({ status: 'APPROVED', reviewedBy: expect.any(String) });
    expect((await ctx.http().post(`${API}/attendance/regularizations/${own.id}/cancel`).set(lead.h)).body.data.status).toBe('CANCELLED');
  });

  it('closes and reopens a month', async () => {
    const { h, person } = await setup();
    const emp = await person(['employee']);
    const put = () => ctx.http().put(`${API}/attendance/records`).set(h).send({ employeeId: emp.employee.id, workDate: '2025-03-03', checkIn: '09:00', checkOut: '18:00', note: 'Correction' });

    expect((await put()).status).toBe(200);
    const closed = await ctx.http().post(`${API}/attendance/periods/2025/3/close`).set(h);
    expect(closed.status).toBe(201);
    expect(closed.body.data).toMatchObject({ closed: true, summary: { records: 1, present: 1 } });
    expect((await ctx.http().post(`${API}/attendance/periods/2025/3/close`).set(h)).status).toBe(409);
    expect((await put()).status).toBe(409);
    expect((await ctx.http().post(`${API}/attendance/periods/2999/1/close`).set(h)).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/periods/2025/3/close`).set(emp.h)).status).toBe(403);

    expect((await ctx.http().post(`${API}/attendance/periods/2025/3/reopen`).set(h)).body.data.closed).toBe(false);
    expect((await put()).status).toBe(200);
  });

  it('manages shifts with a single default and applies them to employees', async () => {
    const { h, person } = await setup();
    const emp = await person(['employee']);
    const general = (await ctx.http().post(`${API}/attendance/shifts`).set(h).send({ name: 'General', startTime: '09:30', endTime: '18:30' })).body.data;
    expect(general.isDefault).toBe(true);
    const night = await ctx.http().post(`${API}/attendance/shifts`).set(h).send({ name: 'Night', startTime: '22:00', endTime: '06:00', weeklyOffs: [0], halfDayMinutes: 300, fullDayMinutes: 420 });
    expect(night.body.data).toMatchObject({ isDefault: false, weeklyOffs: [0] });
    expect((await ctx.http().post(`${API}/attendance/shifts`).set(h).send({ name: 'Bad', startTime: '09:00', endTime: '18:00', halfDayMinutes: 500, fullDayMinutes: 400 })).status).toBe(422);
    expect((await ctx.http().delete(`${API}/attendance/shifts/${general.id}`).set(h)).status).toBe(409);

    // Unassigned employees follow the default shift.
    expect((await ctx.http().get(`${API}/attendance/calendar?month=2025-03`).set(emp.h)).body.data.shift).toMatchObject({ name: 'General', startTime: '09:30' });
    await ctx.http().patch(`${API}/employees/${emp.employee.id}`).set(h).send({ shiftId: night.body.data.id });
    const cal = (await ctx.http().get(`${API}/attendance/calendar?month=2025-03`).set(emp.h)).body.data;
    expect(cal.shift).toMatchObject({ name: 'Night', crossesMidnight: true });
    expect(cal.days.find((d: { date: string }) => d.date === '2025-03-01').status).toBe('ABSENT');

    // Night shift: a check-out before the check-in is the next morning.
    const rec = await ctx.http().put(`${API}/attendance/records`).set(h).send({ employeeId: emp.employee.id, workDate: '2025-03-03', checkIn: '22:05', checkOut: '06:10', note: 'Night' });
    expect(rec.body.data).toMatchObject({ workedMinutes: 485, status: 'PRESENT', lateMinutes: 0 });

    await ctx.http().patch(`${API}/attendance/shifts/${night.body.data.id}`).set(h).send({ isDefault: true });
    const shifts = (await ctx.http().get(`${API}/attendance/shifts`).set(h)).body.data;
    expect(shifts.filter((s: { isDefault: boolean }) => s.isDefault).map((s: { name: string }) => s.name)).toEqual(['Night']);
  });
});
