import { rangeMinutes, timesheetDueDate, weekStartOf, type TimesheetEntry, type TimesheetMissedAction, type TimesheetStatus } from '../../contracts';
import { addDays } from '../../common/utils/zoned-time';

/** The organization's timesheet rules (kept with the payroll settings). */
export interface TimesheetRules {
  required: boolean;
  /** Monday of the first week that needs a timesheet. */
  from: string | null;
  dueWeekday: number;
  missedAction: TimesheetMissedAction;
}

export const NO_TIMESHEET_RULES: TimesheetRules = { required: false, from: null, dueWeekday: 1, missedAction: 'FLAG' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekDates = (weekStart: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/** "9 Nov", for notifications and payslip warnings. */
export function weekLabel(weekStart: string): string {
  const [, m, d] = weekStart.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Mon 16 Nov". */
export function dateLabel(date: string): string {
  return `${WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${weekLabel(date)}`;
}

/** The latest week whose timesheet was due on or before `today`. */
export function latestDueWeek(today: string, dueWeekday: number): string {
  let week = addDays(weekStartOf(today), -7);
  while (timesheetDueDate(week, dueWeekday) > today) week = addDays(week, -7);
  return week;
}

export type ReminderKind = 'MANUAL' | 'DUE' | 'OVERDUE';

const CONSEQUENCE: Record<TimesheetMissedAction, string> = {
  FLAG: 'Payroll flags it until it is approved.',
  LOP: 'Working days of that week count as loss of pay unless it is approved before payroll.',
  HOLD: 'Your salary is held in payroll until it is approved.',
};

/** What a reminder says, by kind (manual, due today, overdue) and where the person's timesheet stands. */
export function reminderText(kind: ReminderKind, status: TimesheetStatus | 'MISSING', week: string, due: string, rules: TimesheetRules): { title: string; body: string } {
  if (kind === 'DUE') {
    return {
      title: status === 'REJECTED' ? `Your timesheet for the week of ${week} needs changes — due today` : `Your timesheet for the week of ${week} is due today`,
      body: status === 'DRAFT' ? 'Your draft is saved; submit it for review today.' : 'Submit it today so it can be reviewed before payroll.',
    };
  }
  if (kind === 'OVERDUE') return { title: `Your timesheet for the week of ${week} is overdue`, body: `It was due on ${dateLabel(due)}. ${rules.required ? CONSEQUENCE[rules.missedAction] : ''}`.trim() };
  const what = status === 'REJECTED' ? 'needs your changes' : status === 'DRAFT' ? "isn't submitted yet" : 'is missing';
  return { title: `Reminder: your timesheet for the week of ${week} ${what}`, body: `It's due by ${dateLabel(due)}.` };
}

export const hoursLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
};

type EntryInput = { day: number; project: string; activity?: string | null; start?: string | null; end?: string | null; minutes?: number | null; note?: string | null };

/**
 * Trims text, works out the duration of timed entries, drops empty rows (no project and no time) and sorts by day
 * and start time.
 */
export function cleanEntries(entries: EntryInput[]): TimesheetEntry[] {
  return entries
    .map((e) => {
      const start = e.start || null;
      const end = e.end || null;
      const timed = !!start && !!end;
      return {
        day: e.day,
        project: e.project.trim(),
        activity: e.activity?.trim() || null,
        start: timed ? start : null,
        end: timed ? end : null,
        minutes: timed ? rangeMinutes(start!, end!) : Math.max(0, Math.round(e.minutes ?? 0)),
        note: e.note?.trim() || null,
      };
    })
    .filter((e) => e.project || e.minutes > 0)
    .sort((a, b) => a.day - b.day || (a.start ?? '99').localeCompare(b.start ?? '99'));
}

/** Minutes per day across all entries, Monday first. */
export function dayTotals(entries: TimesheetEntry[]): number[] {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const e of entries) totals[e.day]! += e.minutes;
  return totals;
}

/** Pairs of timed entries on the same day whose ranges overlap (indexes into the cleaned, sorted list). */
export function overlaps(entries: TimesheetEntry[]): [number, number][] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const span = (e: TimesheetEntry) => [toMin(e.start!), toMin(e.start!) + e.minutes] as const;
  const out: [number, number][] = [];
  entries.forEach((a, i) => {
    if (!a.start) return;
    for (let j = i + 1; j < entries.length; j++) {
      const b = entries[j]!;
      if (b.day !== a.day || !b.start) continue;
      const [a0, a1] = span(a);
      const [b0, b1] = span(b);
      if (a0 < b1 && b0 < a1) out.push([i, j]);
    }
  });
  return out;
}

export interface TimesheetGaps {
  /** Weeks past their due date without an approved timesheet. */
  missed: string[];
  /** Weeks past due whose timesheet is submitted and waiting for review. */
  pending: string[];
  /** Weeks with working days in the period whose timesheet isn't due yet (not counted this time). */
  notDue: string[];
  /** Working days that fall in missed weeks. */
  missedDays: Set<string>;
}

/**
 * Which weeks of a pay period count as missing a timesheet. A week counts once its due day has passed and it has
 * working days for the employee in the period; only an approved timesheet clears it.
 */
export function timesheetGaps(input: {
  days: string[];
  today: string;
  rules: TimesheetRules;
  isWorkingDay: (date: string) => boolean;
  statusOf: (weekStart: string) => TimesheetStatus | undefined;
}): TimesheetGaps {
  const missed = new Set<string>();
  const pending = new Set<string>();
  const notDue = new Set<string>();
  const missedDays = new Set<string>();
  const { rules } = input;
  if (!rules.required) return { missed: [], pending: [], notDue: [], missedDays };
  for (const date of input.days) {
    if (rules.from && date < rules.from) continue;
    if (!input.isWorkingDay(date)) continue;
    const week = weekStartOf(date);
    const status = input.statusOf(week);
    if (status === 'APPROVED') continue;
    if (timesheetDueDate(week, rules.dueWeekday) >= input.today) {
      notDue.add(week);
      continue;
    }
    if (status === 'SUBMITTED') {
      pending.add(week);
      continue;
    }
    missed.add(week);
    missedDays.add(date);
  }
  const sorted = (s: Set<string>) => [...s].sort();
  return { missed: sorted(missed), pending: sorted(pending), notDue: sorted(notDue), missedDays };
}

/** "the week of 3 Nov" / "the weeks of 3 Nov and 10 Nov". */
export function weeksPhrase(weeks: string[]): string {
  const labels = weeks.map(weekLabel);
  if (labels.length <= 1) return `the week of ${labels[0] ?? ''}`;
  return `the weeks of ${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}
