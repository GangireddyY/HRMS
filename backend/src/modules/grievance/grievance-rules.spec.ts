import { addMonths, closeBlocker, daysBetween, dueDate, isOverdue, poshAnnualReport, poshFiling, reopenBlocker, type ResolvedCase } from './grievance-rules';

describe('grievance rules', () => {
  it('sets 30 days for grievances and 90 days for POSH inquiries', () => {
    expect(dueDate('WORKPLACE', '2026-01-10')).toBe('2026-02-09');
    expect(dueDate('POSH', '2026-01-10')).toBe('2026-04-10');
  });

  it('adds months clamped to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });

  it('classifies POSH complaints by the 3-month limit and its 3-month extension', () => {
    expect(poshFiling(null, '2026-06-01')).toBe('ON_TIME');
    expect(poshFiling('2026-03-01', '2026-06-01')).toBe('ON_TIME');
    expect(poshFiling('2026-03-01', '2026-06-02')).toBe('LATE');
    expect(poshFiling('2026-03-01', '2026-09-01')).toBe('LATE');
    expect(poshFiling('2026-03-01', '2026-09-02')).toBe('BEYOND_EXTENSION');
  });

  it('flags open cases past their due date', () => {
    expect(isOverdue({ status: 'INVESTIGATING', dueOn: '2026-02-01' }, '2026-02-02')).toBe(true);
    expect(isOverdue({ status: 'INVESTIGATING', dueOn: '2026-02-01' }, '2026-02-01')).toBe(false);
    expect(isOverdue({ status: 'RESOLVED', dueOn: '2026-02-01' }, '2026-03-01')).toBe(false);
  });

  const resolved = (over: Partial<ResolvedCase> = {}): ResolvedCase => ({ category: 'WORKPLACE', status: 'RESOLVED', reopened: false, resolvedOn: '2026-03-01', acceptedAt: null, ...over });

  it('lets the complainant reopen a resolved grievance once within 15 days', () => {
    expect(reopenBlocker(resolved(), '2026-03-16')).toBeNull();
    expect(reopenBlocker(resolved(), '2026-03-17')).toMatch(/until 2026-03-16/);
    expect(reopenBlocker(resolved({ reopened: true }), '2026-03-02')).toMatch(/already been reopened/);
    expect(reopenBlocker(resolved({ category: 'POSH' }), '2026-03-02')).toMatch(/appellate authority/);
    expect(reopenBlocker(resolved({ status: 'CLOSED' }), '2026-03-02')).toMatch(/Only a resolved case/);
  });

  it('closes once accepted, after the reopening window, after a reopening, or at any time for POSH', () => {
    expect(closeBlocker(resolved(), '2026-03-10')).toMatch(/until 2026-03-16/);
    expect(closeBlocker(resolved(), '2026-03-17')).toBeNull();
    expect(closeBlocker(resolved({ acceptedAt: new Date() }), '2026-03-02')).toBeNull();
    expect(closeBlocker(resolved({ reopened: true }), '2026-03-02')).toBeNull();
    expect(closeBlocker(resolved({ category: 'POSH' }), '2026-03-02')).toBeNull();
    expect(closeBlocker(resolved({ status: 'INVESTIGATING' }), '2026-03-20')).toMatch(/Only a resolved case/);
  });

  it('builds the POSH annual report for a calendar year', () => {
    const cases = [
      { submittedOn: '2025-11-20', resolvedOn: '2026-02-10', withdrawnOn: null, outcome: 'UPHELD' as const },
      { submittedOn: '2026-01-15', resolvedOn: '2026-03-30', withdrawnOn: null, outcome: 'NOT_UPHELD' as const },
      { submittedOn: '2026-02-01', resolvedOn: null, withdrawnOn: null, outcome: null },
      { submittedOn: '2026-05-01', resolvedOn: null, withdrawnOn: '2026-05-20', outcome: null },
      { submittedOn: '2026-11-01', resolvedOn: null, withdrawnOn: null, outcome: null },
      { submittedOn: '2027-01-05', resolvedOn: null, withdrawnOn: null, outcome: null },
    ];
    expect(poshAnnualReport(cases, 2026, '2027-02-01')).toEqual({
      year: 2026,
      asOf: '2026-12-31',
      received: 4,
      disposed: 2,
      withdrawn: 1,
      pending: 2,
      pendingOver90Days: 1,
      outcomes: { UPHELD: 1, NOT_UPHELD: 1 },
    });
    expect(poshAnnualReport(cases, 2025, '2027-02-01')).toMatchObject({ received: 1, disposed: 0, pending: 1, pendingOver90Days: 0 });
    // The current year is reported up to today.
    expect(poshAnnualReport(cases, 2026, '2026-06-01')).toMatchObject({ asOf: '2026-06-01', received: 3, pending: 1, pendingOver90Days: 1 });
  });
});
