import { reminderDue } from './timesheet-reminder.job';
import { latestDueWeek, reminderText, type TimesheetRules } from './timesheet-rules';

const NINE = 9 * 60;
const RULES: TimesheetRules = { required: true, from: null, dueWeekday: 1, missedAction: 'LOP' };

describe('latestDueWeek', () => {
  it('is the week whose due day was most recently reached', () => {
    // Due Monday: on Mon 16 Nov the week of 9 Nov is due; on Sun 15 Nov it is still the week of 2 Nov.
    expect(latestDueWeek('2026-11-16', 1)).toBe('2026-11-09');
    expect(latestDueWeek('2026-11-15', 1)).toBe('2026-11-02');
    // Due Friday: on Fri 20 Nov the week of 9 Nov is due; on Thu 19 Nov the week of 2 Nov.
    expect(latestDueWeek('2026-11-20', 5)).toBe('2026-11-09');
    expect(latestDueWeek('2026-11-19', 5)).toBe('2026-11-02');
  });
});

describe('reminderDue', () => {
  it('sends the due-day reminder on the due day from 9:00', () => {
    expect(reminderDue('2026-11-16', NINE - 1, 1, null)).toBeNull();
    expect(reminderDue('2026-11-16', NINE, 1, null)).toEqual({ kind: 'DUE', week: '2026-11-09' });
  });

  it('sends the overdue reminder the day after, catching up for a few days only', () => {
    expect(reminderDue('2026-11-17', NINE + 30, 1, null)).toEqual({ kind: 'OVERDUE', week: '2026-11-09' });
    expect(reminderDue('2026-11-19', NINE, 1, null)).toEqual({ kind: 'OVERDUE', week: '2026-11-09' });
    expect(reminderDue('2026-11-20', NINE, 1, null)).toBeNull();
  });

  it('skips weeks before timesheets were required', () => {
    expect(reminderDue('2026-11-16', NINE, 1, '2026-11-16')).toBeNull();
    expect(reminderDue('2026-11-16', NINE, 1, '2026-11-09')).toEqual({ kind: 'DUE', week: '2026-11-09' });
  });
});

describe('reminderText', () => {
  it('says what is due and what a missed week costs', () => {
    expect(reminderText('DUE', 'MISSING', '9 Nov', '2026-11-16', RULES).title).toBe('Your timesheet for the week of 9 Nov is due today');
    expect(reminderText('DUE', 'DRAFT', '9 Nov', '2026-11-16', RULES).body).toContain('draft is saved');
    const overdue = reminderText('OVERDUE', 'MISSING', '9 Nov', '2026-11-16', RULES);
    expect(overdue.title).toBe('Your timesheet for the week of 9 Nov is overdue');
    expect(overdue.body).toBe('It was due on Mon 16 Nov. Working days of that week count as loss of pay unless it is approved before payroll.');
    expect(reminderText('MANUAL', 'REJECTED', '9 Nov', '2026-11-16', RULES).title).toBe('Reminder: your timesheet for the week of 9 Nov needs your changes');
  });
});
