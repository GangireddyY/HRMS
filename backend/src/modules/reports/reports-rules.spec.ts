import { attritionRate, countBy, employedOn, headcountTrend, leftIn, median, monthsBetween, pct, tenureBand, type PersonFacts } from './reports-rules';

const p = (dateOfJoining: string, exitDate: string | null = null, status: PersonFacts['status'] = exitDate ? 'EXITED' : 'ACTIVE'): PersonFacts => ({ dateOfJoining, exitDate, status });

describe('reports rules', () => {
  it('counts people employed on a day, including their last working day', () => {
    expect(employedOn(p('2026-01-10'), '2026-01-09')).toBe(false);
    expect(employedOn(p('2026-01-10'), '2026-01-10')).toBe(true);
    expect(employedOn(p('2024-01-01', '2026-03-31'), '2026-03-31')).toBe(true);
    expect(employedOn(p('2024-01-01', '2026-03-31'), '2026-04-01')).toBe(false);
    // Serving notice: employed until the last working day.
    expect(employedOn(p('2024-01-01', '2026-12-15', 'ON_NOTICE'), '2026-11-30')).toBe(true);
    // Exited without a recorded exit date: not counted.
    expect(employedOn(p('2024-01-01', null, 'EXITED'), '2025-01-01')).toBe(false);
  });

  it('counts leavers only once their last working day has passed', () => {
    expect(leftIn(p('2024-01-01', '2026-03-31'), '2026-03-01', '2026-03-31', '2026-11-06')).toBe(true);
    expect(leftIn(p('2024-01-01', '2026-12-15', 'ON_NOTICE'), '2026-12-01', '2026-12-31', '2026-11-06')).toBe(false);
  });

  it('builds a monthly trend up to the as-of day', () => {
    const people = [p('2025-06-01'), p('2026-09-15'), p('2025-01-01', '2026-10-20'), p('2026-11-03')];
    expect(headcountTrend(people, '2026-11-06', 3)).toEqual([
      { month: '2026-09', headcount: 3, joiners: 1, leavers: 0 },
      { month: '2026-10', headcount: 2, joiners: 0, leavers: 1 },
      { month: '2026-11', headcount: 3, joiners: 1, leavers: 0 },
    ]);
  });

  it('calculates attrition over the average headcount, and annualized', () => {
    expect(attritionRate(3, 100, 98, 91)).toEqual({ rate: 3, annualized: 12.2 });
    expect(attritionRate(0, 0, 0, 30)).toEqual({ rate: null, annualized: null });
    expect(pct(1, 3)).toBe(33.3);
  });

  it('groups tenure at exit', () => {
    expect(tenureBand('2026-01-01', '2026-06-30')).toBe('Under 1 year');
    expect(tenureBand('2025-01-01', '2025-12-31')).toBe('1–3 years');
    expect(tenureBand('2021-01-01', '2025-12-31')).toBe('5 years or more');
  });

  it('counts by key with shares, and finds medians and month ranges', () => {
    expect(countBy(['a', 'b', 'a', 'c'], (x) => x)).toEqual([
      { name: 'a', count: 2, share: 50 },
      { name: 'b', count: 1, share: 25 },
      { name: 'c', count: 1, share: 25 },
    ]);
    expect(median([])).toBeNull();
    expect(median([30, 10, 20])).toBe(20);
    expect(median([10, 20, 30, 41])).toBe(25);
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });
});
