import { DEFAULT_MERIT_MATRIX } from '../../contracts';
import { budgetUse, guidelineFor, increasedCtc, matrixProblems, outsideGuideline } from './hike-rules';

describe('hike rules', () => {
  it('finds the guideline for a rating and whether a percentage is outside it', () => {
    expect(guidelineFor(null, 4)).toEqual({ rating: 4, min: 8, target: 10, max: 12 });
    const custom = DEFAULT_MERIT_MATRIX.map((g) => (g.rating === 4 ? { ...g, target: 9 } : g));
    expect(guidelineFor(custom, 4).target).toBe(9);
    expect(outsideGuideline(13, guidelineFor(null, 4))).toBe(true);
    expect(outsideGuideline(8, guidelineFor(null, 4))).toBe(false);
    expect(increasedCtc(720000, 10)).toBe(792000);
    expect(increasedCtc(655555, 7.5)).toBe(704722);
  });

  it('validates a merit matrix', () => {
    expect(matrixProblems([...DEFAULT_MERIT_MATRIX])).toEqual([]);
    expect(matrixProblems(DEFAULT_MERIT_MATRIX.filter((g) => g.rating !== 2))).toEqual(['Give exactly one guideline for rating 2']);
    expect(matrixProblems(DEFAULT_MERIT_MATRIX.map((g) => (g.rating === 5 ? { ...g, target: 25 } : g)))).toEqual(['Rating 5: keep 0 ≤ minimum ≤ target ≤ maximum ≤ 100']);
  });

  it('works out the budget pool and how much is used', () => {
    const lines = [
      { currentCtc: 1_000_000, newCtc: 1_100_000, status: 'APPROVED' },
      { currentCtc: 500_000, newCtc: 530_000, status: 'SUBMITTED' },
      { currentCtc: 500_000, newCtc: 500_000, status: 'REJECTED' },
    ];
    expect(budgetUse(lines, 8)).toEqual({ base: 2_000_000, pool: 160_000, recommended: 130_000, approved: 100_000, remaining: 60_000, averagePercent: 6.5 });
    expect(budgetUse(lines, null).pool).toBeNull();
  });
});
