import { RECOMMENDED_OBLIGATIONS, ackDueOn, ackState, acknowledgementBasis, dateIn, filingState, inAudience, occurrences, scheduleProblems } from './compliance-rules';

describe('compliance rules', () => {
  it('targets policies by department, location and employment type', () => {
    const e = { departmentId: 'd1', locationId: 'l1', employmentType: 'FULL_TIME' as const };
    expect(inAudience({ departmentIds: null, locationIds: null, employmentTypes: null }, e)).toBe(true);
    expect(inAudience({ departmentIds: ['d1'], locationIds: [], employmentTypes: ['FULL_TIME', 'CONTRACT'] }, e)).toBe(true);
    expect(inAudience({ departmentIds: ['d2'], locationIds: null, employmentTypes: null }, e)).toBe(false);
    expect(inAudience({ departmentIds: null, locationIds: null, employmentTypes: ['INTERN'] }, e)).toBe(false);
  });

  it('keeps acknowledgements valid across minor versions', () => {
    const v = (version: number, reacknowledge: boolean) => ({ version, reacknowledge, publishedOn: `2026-0${version}-01` });
    expect(acknowledgementBasis([])).toBeNull();
    expect(acknowledgementBasis([v(1, false)])?.version).toBe(1);
    expect(acknowledgementBasis([v(1, true), v(2, false), v(3, false)])?.version).toBe(1);
    expect(acknowledgementBasis([v(1, true), v(2, true), v(3, false)])?.version).toBe(2);
    expect(ackState([1], 1, '2026-02-01', '2026-03-01')).toBe('ACKNOWLEDGED');
    expect(ackState([1], 2, '2026-02-01', '2026-01-20')).toBe('PENDING');
    expect(ackState([1], 2, '2026-02-01', '2026-02-02')).toBe('OVERDUE');
    expect(ackState([3], 2, '2026-02-01', '2026-02-02')).toBe('ACKNOWLEDGED');
  });

  it('gives later joiners time from their joining date', () => {
    expect(ackDueOn('2026-03-01', '2024-01-08', 14)).toBe('2026-03-15');
    expect(ackDueOn('2026-03-01', '2026-06-10', 14)).toBe('2026-06-24');
  });

  it('validates yearly schedules', () => {
    expect(scheduleProblems([])).toEqual(['Add at least one due date']);
    expect(scheduleProblems(['13-01', '1-5'])).toEqual(['Use month-day dates such as 01-15 (not 13-01, 1-5)']);
    expect(scheduleProblems(['01-15', '01-15'])).toEqual(['The same due date is listed twice']);
    expect(scheduleProblems(['02-30', '12-31'])).toEqual([]);
    for (const o of RECOMMENDED_OBLIGATIONS) expect(scheduleProblems(o.dueDates)).toEqual([]);
  });

  it('lists due dates in a range, clamped to month ends and the active period', () => {
    expect(dateIn(2026, '02-30')).toBe('2026-02-28');
    expect(dateIn(2028, '02-30')).toBe('2028-02-29');
    const quarterly = { dueDates: ['01-31', '05-31', '07-31', '10-31'], startsOn: '2026-01-01', endsOn: null };
    expect(occurrences(quarterly, '2026-06-01', '2027-02-15')).toEqual(['2026-07-31', '2026-10-31', '2027-01-31']);
    expect(occurrences({ ...quarterly, startsOn: '2026-08-01' }, '2026-06-01', '2027-02-15')).toEqual(['2026-10-31', '2027-01-31']);
    expect(occurrences({ ...quarterly, endsOn: '2026-12-31' }, '2026-06-01', '2027-02-15')).toEqual(['2026-07-31', '2026-10-31']);
    const tds = RECOMMENDED_OBLIGATIONS.find((o) => o.title === 'TDS deposit on salaries')!;
    expect(occurrences({ dueDates: tds.dueDates, startsOn: '2026-01-01', endsOn: null }, '2026-03-01', '2026-05-31')).toEqual(['2026-03-07', '2026-04-30', '2026-05-07']);
  });

  it('classifies filings as done, overdue, due soon or upcoming', () => {
    expect(filingState('2026-03-15', true, '2026-04-01')).toBe('DONE');
    expect(filingState('2026-03-15', false, '2026-03-16')).toBe('OVERDUE');
    expect(filingState('2026-03-15', false, '2026-03-15')).toBe('DUE_SOON');
    expect(filingState('2026-03-15', false, '2026-03-08')).toBe('DUE_SOON');
    expect(filingState('2026-03-15', false, '2026-03-07')).toBe('UPCOMING');
  });
});
