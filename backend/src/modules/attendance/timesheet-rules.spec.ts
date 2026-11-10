import { timesheetDueDate, weekStartOf } from '../../contracts';
import { cleanEntries, dayTotals, overlaps, timesheetGaps, weekLabel, weeksPhrase, type TimesheetRules } from './timesheet-rules';

const RULES: TimesheetRules = { required: true, from: '2026-10-05', dueWeekday: 1, missedAction: 'LOP' };
const october = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const weekdaysOnly = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

describe('timesheet weeks', () => {
  it('starts weeks on Monday and is due on the chosen weekday after the week', () => {
    expect(weekStartOf('2026-11-10')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09');
    expect(weekStartOf('2026-11-15')).toBe('2026-11-09');
    expect(timesheetDueDate('2026-11-09', 1)).toBe('2026-11-16');
    expect(timesheetDueDate('2026-11-09', 5)).toBe('2026-11-20');
    expect(timesheetDueDate('2026-11-09', 0)).toBe('2026-11-22');
  });

  it('labels weeks for messages', () => {
    expect(weekLabel('2026-11-09')).toBe('9 Nov');
    expect(weeksPhrase(['2026-11-02'])).toBe('the week of 2 Nov');
    expect(weeksPhrase(['2026-10-26', '2026-11-02', '2026-11-09'])).toBe('the weeks of 26 Oct, 2 Nov and 9 Nov');
  });
});

describe('cleanEntries / dayTotals / overlaps', () => {
  it('works out durations, drops empty rows, sorts by day and time and adds up each day', () => {
    const entries = cleanEntries([
      { day: 1, project: 'Hiring', start: '14:00', end: '16:30' },
      { day: 0, project: ' Payroll ', activity: '  ', start: '08:49', end: '17:49' },
      { day: 2, project: '', minutes: 0 },
      { day: 1, project: 'Hiring', activity: 'Interviews', minutes: 90 },
      { day: 1, project: 'Support', start: '09:00', end: '12:00', note: ' Release day ' },
      { day: 4, project: 'Night release', start: '22:00', end: '01:30' },
    ]);
    expect(entries.map((e) => [e.day, e.project, e.start, e.minutes])).toEqual([
      [0, 'Payroll', '08:49', 540],
      [1, 'Support', '09:00', 180],
      [1, 'Hiring', '14:00', 150],
      [1, 'Hiring', null, 90],
      [4, 'Night release', '22:00', 210],
    ]);
    expect(entries[0]!.activity).toBeNull();
    expect(entries[1]!.note).toBe('Release day');
    expect(dayTotals(entries)).toEqual([540, 420, 0, 0, 210, 0, 0]);
  });

  it('finds overlapping time ranges on the same day only', () => {
    const entries = cleanEntries([
      { day: 0, project: 'A', start: '09:00', end: '12:00' },
      { day: 0, project: 'B', start: '11:30', end: '13:00' },
      { day: 0, project: 'C', start: '13:00', end: '14:00' },
      { day: 1, project: 'D', start: '09:00', end: '12:00' },
    ]);
    expect(overlaps(entries)).toEqual([[0, 1]]);
  });
});

describe('timesheetGaps', () => {
  it('ignores everything when timesheets are not required', () => {
    const gaps = timesheetGaps({ days: october, today: '2026-11-05', rules: { ...RULES, required: false }, isWorkingDay: () => true, statusOf: () => undefined });
    expect(gaps.missed).toEqual([]);
    expect(gaps.missedDays.size).toBe(0);
  });

  it('counts working days of weeks past due without an approved timesheet', () => {
    const status: Record<string, 'APPROVED' | 'SUBMITTED' | 'DRAFT'> = { '2026-10-05': 'APPROVED', '2026-10-12': 'SUBMITTED', '2026-10-19': 'DRAFT' };
    const gaps = timesheetGaps({ days: october, today: '2026-11-02', rules: RULES, isWorkingDay: weekdaysOnly, statusOf: (w) => status[w] });
    // 1–4 Oct is before the rule started; 5 Oct approved; 12 Oct waiting for review; 19 Oct a draft; 26 Oct (due 2 Nov) not due yet.
    expect(gaps.missed).toEqual(['2026-10-19']);
    expect(gaps.pending).toEqual(['2026-10-12']);
    expect(gaps.notDue).toEqual(['2026-10-26']);
    expect([...gaps.missedDays]).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('only counts days inside the period and weeks with working days', () => {
    const gaps = timesheetGaps({ days: october, today: '2026-11-10', rules: RULES, isWorkingDay: (d) => weekdaysOnly(d) && d < '2026-10-26', statusOf: () => undefined });
    expect(gaps.missed).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    expect(gaps.missedDays.size).toBe(15);
  });
});
