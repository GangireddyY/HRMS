import { weekStartOf } from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';
import type { Json, Kit } from './kit';

const PAYROLL = 'payroll@acme.test';
const REVIEWER = 'hr.manager@acme.test';

/** A person's usual working day: activities with From–To times (shifted a few minutes from day to day). */
type Plan = { project: string; activity: string; start: string; end: string }[];

const PLANS: Record<string, Plan> = {
  'employee@acme.test': [
    { project: 'HRMS mobile app', activity: 'Development', start: '09:00', end: '13:00' },
    { project: 'HRMS mobile app', activity: 'Code review', start: '14:00', end: '16:00' },
    { project: 'Internal', activity: 'Team meetings', start: '16:00', end: '17:00' },
  ],
  'karthik@acme.test': [
    { project: 'Payments API', activity: 'Development', start: '09:30', end: '13:30' },
    { project: 'Payments API', activity: 'Testing', start: '14:30', end: '16:30' },
    { project: 'On-call support', activity: 'Support', start: '16:30', end: '18:00' },
  ],
  'pooja@acme.test': [
    { project: 'Client onboarding — Zenith Foods', activity: 'Data migration', start: '09:00', end: '13:00' },
    { project: 'Client onboarding — Zenith Foods', activity: 'Client call', start: '14:00', end: '15:30' },
    { project: 'Internal', activity: 'Training', start: '15:30', end: '17:30' },
  ],
  'divya@acme.test': [
    { project: 'Quarterly sales review', activity: 'Pipeline report', start: '09:15', end: '13:15' },
    { project: 'Customer calls', activity: 'Calls', start: '14:00', end: '18:00' },
  ],
};

const shift = (time: string, minutes: number) => {
  const t = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Timesheets switched on (flag only, so pay is unchanged) and a mix of weeks: approved, waiting for review, sent back,
 * a draft, and people who haven't submitted at all — for My workspace → Timesheets and HR → Attendance → Timesheets.
 */
export async function seedTimesheetExtras(kit: Kit): Promise<void> {
  const thisWeek = weekStartOf(kit.today);
  const lastWeek = addDays(thisWeek, -7);
  const twoWeeksAgo = addDays(thisWeek, -14);
  await kit.step('Timesheets: required every week, due Monday, flagged on payslips when missed', () => rules(kit, addDays(thisWeek, -21)));
  await kit.step('Timesheets: Asha — approved two weeks ago, last week waiting for review, this week in progress', async () => {
    const a = await sheet(kit, 'employee@acme.test', twoWeeksAgo, 'approve');
    const b = await sheet(kit, 'employee@acme.test', lastWeek, 'submit');
    const c = await sheet(kit, 'employee@acme.test', thisWeek, 'draft');
    return [a, b, c].every((x) => x === 'skipped') ? 'skipped' : undefined;
  });
  await kit.step('Timesheets: Karthik — last week sent back for changes', () => sheet(kit, 'karthik@acme.test', lastWeek, 'reject'));
  await kit.step('Timesheets: Pooja — last week waiting for review', () => sheet(kit, 'pooja@acme.test', lastWeek, 'submit'));
  await kit.step('Timesheets: Divya — last week saved as a draft, not submitted', () => sheet(kit, 'divya@acme.test', lastWeek, 'draft'));
}

async function rules(kit: Kit, from: string) {
  const payroll = await kit.as(PAYROLL);
  const current = (await payroll.get('/payroll/settings')) as Json;
  if (current.timesheetsRequired) return 'skipped';
  await payroll.put('/payroll/settings', { timesheetsRequired: true, timesheetDueWeekday: 1, timesheetMissedAction: 'FLAG', timesheetsFrom: from });
}

async function sheet(kit: Kit, email: string, weekStart: string, outcome: 'draft' | 'submit' | 'approve' | 'reject') {
  const person = await kit.person(email);
  const [existing] = await kit.sql<{ n: number }>(`SELECT count(*)::int AS n FROM timesheets WHERE organization_id = :orgId AND employee_id = :employeeId AND week_start = :weekStart`, {
    employeeId: person.employeeId,
    weekStart,
  });
  if (existing!.n) return 'skipped';
  const as = await kit.as(email);
  const week = (await as.get(`/attendance/timesheets/week?weekStart=${weekStart}`)) as Json;
  const days = week.days as { kind: string; expectedMinutes: number; future: boolean; date: string }[];
  const plan = PLANS[email]!;
  // Working days that have passed (today's hours aren't in yet); a few minutes' drift keeps days from looking copied.
  const entries = days.flatMap((d, day) =>
    d.kind !== 'WORKING' || d.future || d.date === kit.today
      ? []
      : plan.map((row, r) => ({ day, project: row.project, activity: row.activity, start: shift(row.start, r === 0 ? (day % 3) * 5 - 5 : 0), end: shift(row.end, r === plan.length - 1 ? ((day + 1) % 3) * 10 : 0), note: null })),
  );
  if (!entries.length) return 'skipped';
  const note = outcome === 'reject' ? 'Thursday was the release day; added the on-call hours.' : null;
  if (outcome === 'draft') {
    await as.put('/attendance/timesheets/week', { weekStart, entries, note });
    return;
  }
  const submitted = (await as.post('/attendance/timesheets/week/submit', { weekStart, entries, note })) as Json;
  const id = submitted.timesheet.id as string;
  const reviewer = await kit.as(REVIEWER);
  if (outcome === 'approve') await reviewer.post(`/attendance/timesheets/${id}/approve`, { note: 'Thanks — looks right.' });
  if (outcome === 'reject') await reviewer.post(`/attendance/timesheets/${id}/reject`, { note: 'Please split the on-call hours by day; Friday shows none.' });
}
