import { AttendanceOvertime, AttendanceRecord } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

/** Dates and times in the organizations' default time zone (Asia/Kolkata, UTC+05:30). */
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const at = (date: string, time: string) => `${date}T${time}:00+05:30`;
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** The first day on or after the 8th of the previous month that falls on the given weekday. */
function lastMonthOn(day: number) {
  const t = istToday();
  const [y, m] = t.split('-').map(Number) as [number, number];
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  let d = `${prev.year}-${String(prev.month).padStart(2, '0')}-08`;
  while (weekday(d) !== day) d = addDays(d, 1);
  return { date: d, ...prev };
}

describe('Attendance: overtime, work from home, rosters and devices (e2e)', () => {
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

  async function person(organizationId: string, h: Record<string, string>, roleKeys: string[], firstName: string, extra: Record<string, unknown> = {}) {
    const user = await createUser(ctx, { email: uniqueEmail('p'), firstName, lastName: 'Person' });
    const membership = await addMember(ctx, organizationId, user.id, roleKeys);
    const res = await ctx.http().post(`${API}/employees`).set(h).send({ firstName, lastName: 'Person', dateOfJoining: '2024-01-08', membershipId: membership.id, ...extra });
    expect(res.status).toBe(201);
    return { user, employee: res.body.data, h: bearer((await login(ctx, user.email)).accessToken) };
  }

  async function team(extra: Record<string, unknown> = {}) {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const hr = await person(org.organization.id, h, ['hr_manager'], 'Hema');
    const lead = await person(org.organization.id, h, ['team_lead'], 'Lalit');
    const asha = await person(org.organization.id, h, ['employee'], 'Asha', { managerId: lead.employee.id, ...extra });
    const ben = await person(org.organization.id, h, ['employee'], 'Ben', { managerId: lead.employee.id, ...extra });
    return { org, h, hr, lead, asha, ben };
  }

  it('counts overtime, takes it through approval and pays it with payroll', async () => {
    const t = await team();
    const shift = await ctx.http().post(`${API}/attendance/shifts`).set(t.h).send({ name: 'General', startTime: '09:00', endTime: '18:00', isDefault: true, overtimeEnabled: true, overtimeAfterMinutes: 540, overtimeMinMinutes: 30 });
    expect(shift.body.data).toMatchObject({ overtimeEnabled: true, overtimeAfterMinutes: 540, overtimeMinMinutes: 30 });
    const wed = lastMonthOn(3);
    const sat = lastMonthOn(6);
    const thu = addDays(wed.date, 1);

    // 09:00–20:30 on a working day: 150 minutes beyond the 9 hours.
    const corrected = await ctx.http().put(`${API}/attendance/records`).set(t.hr.h).send({ employeeId: t.asha.employee.id, workDate: wed.date, checkIn: '09:00', checkOut: '20:30', note: 'Release night' });
    expect(corrected.body.data).toMatchObject({ workedMinutes: 690, overtimeMinutes: 150, status: 'PRESENT' });
    // Everything worked on a weekly off is overtime; less than the minimum isn't counted.
    expect((await ctx.http().put(`${API}/attendance/records`).set(t.hr.h).send({ employeeId: t.asha.employee.id, workDate: sat.date, checkIn: '10:00', checkOut: '14:00', note: 'Weekend support' })).body.data).toMatchObject({ overtimeMinutes: 240, lateMinutes: 0 });
    expect((await ctx.http().put(`${API}/attendance/records`).set(t.hr.h).send({ employeeId: t.asha.employee.id, workDate: thu, checkIn: '09:00', checkOut: '18:20', note: 'Short stay' })).body.data).toMatchObject({ overtimeMinutes: 0 });

    // The team lead approves (fewer minutes allowed, never more); the employee can't.
    const queue = (await ctx.http().get(`${API}/attendance/overtime?view=team&status=PENDING`).set(t.lead.h)).body.data as { id: string; workDate: string; minutes: number }[];
    expect(queue.map((o) => [o.workDate, o.minutes]).sort()).toEqual([[sat.date, 240], [wed.date, 150]].sort());
    const weekdayOt = queue.find((o) => o.workDate === wed.date)!;
    const weekendOt = queue.find((o) => o.workDate === sat.date)!;
    expect((await ctx.http().post(`${API}/attendance/overtime/${weekdayOt.id}/approve`).set(t.asha.h).send({})).status).toBe(403);
    expect((await ctx.http().post(`${API}/attendance/overtime/${weekdayOt.id}/approve`).set(t.lead.h).send({ minutes: 200 })).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/overtime/${weekdayOt.id}/approve`).set(t.lead.h).send({ minutes: 120, note: 'Two hours agreed' })).body.data).toMatchObject({ status: 'APPROVED', approvedMinutes: 120, reviewedBy: 'Lalit Person' });
    expect((await ctx.http().post(`${API}/attendance/overtime/${weekendOt.id}/reject`).set(t.lead.h).send({})).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/overtime/${weekendOt.id}/reject`).set(t.lead.h).send({ note: 'Not pre-approved' })).body.data.status).toBe('REJECTED');

    // Changing the punches sends it back for approval.
    await ctx.http().put(`${API}/attendance/records`).set(t.hr.h).send({ employeeId: t.asha.employee.id, workDate: wed.date, checkIn: '09:00', checkOut: '21:00', note: 'Corrected punch-out' });
    expect(await AttendanceOvertime.findOne({ where: { id: weekdayOt.id }, ...RAW })).toMatchObject({ status: 'PENDING', minutes: 180, approvedMinutes: null });
    // The month can't be closed while overtime waits for approval.
    expect((await ctx.http().post(`${API}/attendance/periods/${wed.year}/${wed.month}/close`).set(t.hr.h).send({})).status).toBe(409);
    await ctx.http().post(`${API}/attendance/overtime/${weekdayOt.id}/approve`).set(t.lead.h).send({});
    const calendar = (await ctx.http().get(`${API}/attendance/calendar?month=${wed.date.slice(0, 7)}`).set(t.asha.h)).body.data;
    expect(calendar.days.find((d: { date: string }) => d.date === wed.date).overtime).toEqual({ status: 'APPROVED', minutes: 180 });
    expect(calendar.summary.overtimeMinutes).toBe(180);
    expect((await ctx.http().get(`${API}/attendance/overtime`).set(t.asha.h)).body.data).toHaveLength(2);

    // Payroll pays approved overtime: hours × (monthly gross ÷ 26 ÷ 8) × 2.
    const pm = await person(t.org.organization.id, t.h, ['payroll_manager'], 'Priya');
    const fin = await person(t.org.organization.id, t.h, ['finance_manager'], 'Farah');
    const structure = (await ctx.http().post(`${API}/payroll/structures/recommended`).set(t.h).send({})).body.data.structures.find((s: { name: string }) => s.name === 'Standard');
    await ctx.http().post(`${API}/payroll/employees/${t.asha.employee.id}/salaries`).set(pm.h).send({ structureId: structure.id, annualCtc: 720000, effectiveFrom: '2024-01-08' });
    const run = (await ctx.http().post(`${API}/payroll/runs`).set(pm.h).send({ year: wed.year, month: wed.month })).body.data;
    const slip = (await ctx.http().get(`${API}/payroll/runs/${run.id}/payslips`).set(pm.h)).body.data.find((p: { employeeId: string }) => p.employeeId === t.asha.employee.id);
    const detail = (await ctx.http().get(`${API}/payroll/payslips/${slip.id}`).set(pm.h)).body.data as { earnings: { code: string; name: string; amount: number; rate?: number }[] };
    const grossRate = detail.earnings.filter((l) => l.rate).reduce((s, l) => s + l.rate!, 0);
    expect(detail.earnings.find((l) => l.code === 'OVERTIME')).toMatchObject({ name: 'Overtime (3 h × 2)', amount: Math.round((3 * grossRate * 2) / 208) });
    await ctx.http().post(`${API}/payroll/runs/${run.id}/submit`).set(pm.h).send({});
    await ctx.http().post(`${API}/payroll/runs/${run.id}/approve`).set(fin.h).send({});
    expect(await AttendanceOvertime.findOne({ where: { id: weekdayOt.id }, ...RAW })).toMatchObject({ payrollRunId: run.id });
    expect((await ctx.http().get(`${API}/attendance/overtime`).set(t.asha.h)).body.data.find((o: { id: string }) => o.id === weekdayOt.id).paidIn).toMatch(new RegExp(`${wed.year}$`));
  });

  it('refuses punches outside the office geofence except on approved work-from-home days', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    expect((await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Nowhere', geofenceRadiusM: 200 })).status).toBe(422);
    const office = (await ctx.http().post(`${API}/locations`).set(h).send({ name: 'Bengaluru HQ', latitude: 12.9716, longitude: 77.5946, geofenceRadiusM: 200 })).body.data;
    expect(office).toMatchObject({ geofenceRadiusM: 200 });
    const t = await (async () => {
      const lead = await person(org.organization.id, h, ['team_lead'], 'Lalit');
      const asha = await person(org.organization.id, h, ['employee'], 'Asha', { managerId: lead.employee.id, locationId: office.id });
      const ben = await person(org.organization.id, h, ['employee'], 'Ben', { managerId: lead.employee.id, locationId: office.id });
      return { lead, asha, ben };
    })();
    const today = istToday();

    expect((await ctx.http().get(`${API}/attendance/today`).set(t.asha.h)).body.data).toMatchObject({ workFromHome: false, geofence: { location: 'Bengaluru HQ', radiusMetres: 200 } });
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(t.asha.h).send({})).status).toBe(422);
    const far = await ctx.http().post(`${API}/attendance/punch-in`).set(t.asha.h).send({ latitude: 13.0827, longitude: 80.2707 });
    expect(far.status).toBe(422);
    expect(far.body.error.details[0].message).toMatch(/km from Bengaluru HQ/);
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(t.asha.h).send({ latitude: 12.9717, longitude: 77.5947 })).body.data.record).toMatchObject({ workMode: 'OFFICE' });

    // Ben works from home today: approved by his team lead, never by himself.
    const wfh = await ctx.http().post(`${API}/attendance/work-from-home`).set(t.ben.h).send({ startDate: today, endDate: today, reason: 'Plumber visit' });
    expect(wfh.status).toBe(201);
    expect((await ctx.http().post(`${API}/attendance/work-from-home`).set(t.ben.h).send({ startDate: today, endDate: addDays(today, 1), reason: 'Overlap test' })).status).toBe(409);
    expect((await ctx.http().post(`${API}/attendance/work-from-home`).set(t.ben.h).send({ startDate: today, endDate: addDays(today, 40), reason: 'Too long' })).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/work-from-home/${wfh.body.data.id}/approve`).set(t.ben.h).send({})).status).toBe(403);
    expect((await ctx.http().get(`${API}/attendance/work-from-home?view=team`).set(t.lead.h)).body.data.map((r: { id: string }) => r.id)).toEqual([wfh.body.data.id]);
    expect((await ctx.http().post(`${API}/attendance/work-from-home/${wfh.body.data.id}/approve`).set(t.lead.h).send({ note: 'Fine' })).body.data).toMatchObject({ status: 'APPROVED', reviewedBy: 'Lalit Person' });
    expect((await ctx.http().get(`${API}/attendance/today`).set(t.ben.h)).body.data).toMatchObject({ workFromHome: true, geofence: null });
    expect((await ctx.http().post(`${API}/attendance/punch-in`).set(t.ben.h).send({})).body.data.record).toMatchObject({ workMode: 'REMOTE' });
    // Approved requests can be withdrawn only before they start.
    expect((await ctx.http().post(`${API}/attendance/work-from-home/${wfh.body.data.id}/cancel`).set(t.ben.h).send({})).status).toBe(409);
    const later = (await ctx.http().post(`${API}/attendance/work-from-home`).set(t.ben.h).send({ startDate: addDays(today, 7), endDate: addDays(today, 8), reason: 'Travel' })).body.data;
    await ctx.http().post(`${API}/attendance/work-from-home/${later.id}/approve`).set(t.lead.h).send({});
    expect((await ctx.http().post(`${API}/attendance/work-from-home/${later.id}/cancel`).set(t.ben.h).send({})).body.data.status).toBe('CANCELLED');

    const register = (await ctx.http().get(`${API}/attendance/daily?status=REMOTE`).set(t.lead.h)).body.data;
    expect(register.summary.remote).toBe(1);
    expect(register.page.items.map((r: { employee: { name: string } }) => r.employee.name)).toEqual(['Ben Person']);
  });

  it('plans rosters with rotations and follows them in attendance and leave', async () => {
    const t = await team();
    const morning = (await ctx.http().post(`${API}/attendance/shifts`).set(t.h).send({ name: 'Morning', startTime: '06:00', endTime: '14:00', weeklyOffs: [] })).body.data;
    const night = (await ctx.http().post(`${API}/attendance/shifts`).set(t.h).send({ name: 'Night', startTime: '22:00', endTime: '06:00', weeklyOffs: [] })).body.data;
    expect((await ctx.http().post(`${API}/attendance/rotations`).set(t.h).send({ name: 'Off only', pattern: [{ shiftId: null, days: 2 }] })).status).toBe(422);
    const rotation = await ctx.http().post(`${API}/attendance/rotations`).set(t.h).send({ name: 'Two-shift', pattern: [{ shiftId: morning.id, days: 2 }, { shiftId: null, days: 1 }, { shiftId: night.id, days: 2 }, { shiftId: null, days: 1 }] });
    expect(rotation.body.data).toMatchObject({ cycleDays: 6, pattern: [{ shiftName: 'Morning' }, { shiftName: null }, { shiftName: 'Night' }, { shiftName: null }] });
    expect((await ctx.http().post(`${API}/attendance/rotations`).set(t.h).send({ name: 'two-SHIFT', pattern: [{ shiftId: morning.id, days: 1 }] })).status).toBe(422);

    const from = addDays(istToday(), 1);
    const to = addDays(from, 5);
    const employees = [t.asha.employee.id, t.ben.employee.id];
    expect((await ctx.http().post(`${API}/attendance/roster/apply-rotation`).set(t.h).send({ employeeIds: employees, rotationId: rotation.body.data.id, from: addDays(from, -2), to })).status).toBe(422);
    expect((await ctx.http().post(`${API}/attendance/roster/apply-rotation`).set(t.lead.h).send({ employeeIds: employees, rotationId: rotation.body.data.id, from, to })).status).toBe(403);
    expect((await ctx.http().post(`${API}/attendance/roster/apply-rotation`).set(t.h).send({ employeeIds: employees, rotationId: rotation.body.data.id, from, to })).status).toBe(201);
    // Ben's team starts three days into the cycle.
    await ctx.http().post(`${API}/attendance/roster/apply-rotation`).set(t.h).send({ employeeIds: [t.ben.employee.id], rotationId: rotation.body.data.id, from, to, offset: 3 });
    const pattern = async (h: Record<string, string>, name: string) => {
      const rows = (await ctx.http().get(`${API}/attendance/roster?from=${from}&to=${to}`).set(h)).body.data.page.items as { employee: { name: string }; days: { off: boolean; shiftName: string }[] }[];
      const row = rows.find((r) => r.employee.name === name);
      return row?.days.map((d) => (d.off ? 'off' : d.shiftName));
    };
    expect(await pattern(t.h, 'Asha Person')).toEqual(['Morning', 'Morning', 'off', 'Night', 'Night', 'off']);
    expect(await pattern(t.h, 'Ben Person')).toEqual(['Night', 'Night', 'off', 'Morning', 'Morning', 'off']);
    // The team lead sees their team's roster; an employee doesn't.
    expect(await pattern(t.lead.h, 'Asha Person')).toEqual(['Morning', 'Morning', 'off', 'Night', 'Night', 'off']);
    expect((await ctx.http().get(`${API}/attendance/roster?from=${from}&to=${to}`).set(t.asha.h)).status).toBe(403);

    // Change a day, then clear two days back to the usual shift.
    await ctx.http().post(`${API}/attendance/roster/assign`).set(t.h).send({ employeeIds: [t.asha.employee.id], shiftId: morning.id, from: addDays(from, 2), to: addDays(from, 2) });
    await ctx.http().post(`${API}/attendance/roster/clear`).set(t.h).send({ employeeIds: [t.asha.employee.id], from: addDays(from, 3), to: addDays(from, 4) });
    // Cleared days fall back to the usual shift, including its own weekly offs (which depend on today's date).
    const usualShift = (await ctx.http().get(`${API}/attendance/shifts`).set(t.h)).body.data.find((s: { isDefault: boolean }) => s.isDefault) as { name: string; weeklyOffs: number[] } | undefined;
    const usual = usualShift?.name ?? 'General (default)';
    const offs = usualShift?.weeklyOffs ?? [0, 6];
    const expected = ['Morning', 'Morning', 'Morning', addDays(from, 3), addDays(from, 4), 'off'].map((x) => (x.startsWith('20') ? (offs.includes(weekday(x)) ? 'off' : usual) : x));
    expect(await pattern(t.h, 'Asha Person')).toEqual(expected);

    // Rostered days off are not counted as leave.
    const type = await ctx.http().post(`${API}/leave/types`).set(t.h).send({ code: 'SPL', name: 'Special leave', unlimited: true, accrualFrequency: 'NONE' });
    expect(type.status).toBe(201);
    const quote = await ctx.http().post(`${API}/leave/requests/quote`).set(t.ben.h).send({ leaveTypeId: type.body.data.id, startDate: from, endDate: to });
    expect(quote.body.data.days).toBe(4);

    // Calendars show the rostered shift of each day.
    const firstMonth = from.slice(0, 7);
    const days = (await ctx.http().get(`${API}/attendance/calendar?month=${firstMonth}`).set(t.ben.h)).body.data.days as { date: string; status: string; shift: { name: string; rostered: boolean } }[];
    const first = days.find((d) => d.date === from)!;
    expect(first.shift).toMatchObject({ name: 'Night', rostered: true });
    const offDay = days.find((d) => d.date === addDays(from, 2));
    if (offDay) expect(offDay.status).toBe('WEEKLY_OFF');
    expect((await ctx.http().delete(`${API}/attendance/rotations/${rotation.body.data.id}`).set(t.h)).status).toBe(409);
  });

  it('takes punches from biometric devices with their own keys', async () => {
    const t = await team();
    const added = await ctx.http().post(`${API}/attendance/devices`).set(t.h).send({ name: 'Main entrance', serialNumber: 'ZK-001' });
    expect(added.status).toBe(201);
    const key = added.body.data.apiKey as string;
    expect(key).toMatch(/^hrmsd_[0-9a-f]{12}_/);
    expect((await ctx.http().get(`${API}/attendance/devices`).set(t.h)).body.data[0]).toMatchObject({ name: 'Main entrance', keyHint: expect.stringMatching(/…$/), punchesLast24h: 0 });
    expect((await ctx.http().get(`${API}/attendance/devices`).set(t.h)).body.data[0].apiKey).toBeUndefined();
    expect((await ctx.http().put(`${API}/attendance/employees/${t.asha.employee.id}/biometric-code`).set(t.h).send({ biometricCode: '1042' })).status).toBe(200);
    expect((await ctx.http().put(`${API}/attendance/employees/${t.ben.employee.id}/biometric-code`).set(t.h).send({ biometricCode: '1042' })).status).toBe(422);

    const day = addDays(istToday(), -1);
    const punches = [
      { userCode: '1042', timestamp: at(day, '09:05') },
      { userCode: '1042', timestamp: at(day, '13:00') },
      { userCode: '1042', timestamp: at(day, '18:40') },
      { userCode: t.ben.employee.employeeCode, timestamp: at(day, '09:30'), direction: 'IN' },
      { userCode: 'X9', timestamp: at(day, '09:00') },
    ];
    expect((await ctx.http().post(`${API}/attendance/device/punches`).send({ punches })).status).toBe(401);
    expect((await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', `${key.slice(0, -1)}${key.endsWith('x') ? 'y' : 'x'}`).send({ punches })).status).toBe(401);
    const pushed = await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', key).send({ punches });
    expect(pushed.status).toBe(201);
    expect(pushed.body.data).toMatchObject({ received: 5, accepted: 4, duplicates: 0, unknownUsers: ['X9'], skipped: [] });
    const asha = await AttendanceRecord.findOne({ where: { employeeId: t.asha.employee.id, workDate: day }, ...RAW });
    expect(asha).toMatchObject({ source: 'DEVICE', workedMinutes: 575 });
    expect(asha!.checkInAt!.toISOString()).toBe(new Date(at(day, '09:05')).toISOString());
    expect(asha!.checkOutAt!.toISOString()).toBe(new Date(at(day, '18:40')).toISOString());
    expect(await AttendanceRecord.findOne({ where: { employeeId: t.ben.employee.id, workDate: day }, ...RAW })).toMatchObject({ checkOutAt: null });
    // Sending the same punches again changes nothing; a later OUT completes Ben's day.
    expect((await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', key).send({ punches })).body.data).toMatchObject({ accepted: 0, duplicates: 4 });
    await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', key).send({ punches: [{ userCode: t.ben.employee.employeeCode, timestamp: at(day, '17:45'), direction: 'OUT' }] });
    expect(await AttendanceRecord.findOne({ where: { employeeId: t.ben.employee.id, workDate: day }, ...RAW })).toMatchObject({ workedMinutes: 495, source: 'DEVICE' });
    expect((await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', key).send({ punches: [{ userCode: '1042', timestamp: at(addDays(istToday(), 2), '09:00') }] })).body.data.skipped[0].reason).toBe('In the future');

    // A new key replaces the old one; deactivated devices are refused.
    const rotated = (await ctx.http().post(`${API}/attendance/devices/${added.body.data.id}/rotate-key`).set(t.h).send({})).body.data.apiKey;
    expect((await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', key).send({ punches })).status).toBe(401);
    await ctx.http().patch(`${API}/attendance/devices/${added.body.data.id}`).set(t.h).send({ isActive: false });
    expect((await ctx.http().post(`${API}/attendance/device/punches`).set('X-Device-Key', rotated).send({ punches })).status).toBe(403);
    expect((await ctx.http().delete(`${API}/attendance/devices/${added.body.data.id}`).set(t.h)).status).toBe(409);

    const other = await createOrgWithAdmin(ctx);
    const oh = bearer((await login(ctx, other.admin.email)).accessToken);
    expect((await ctx.http().get(`${API}/attendance/devices`).set(oh)).body.data).toEqual([]);
    expect((await ctx.http().patch(`${API}/attendance/devices/${added.body.data.id}`).set(oh).send({ name: 'Hijack' })).status).toBe(404);
  });
});
