import { competencyScore, distribution, goalScore, goalWeightProblem, overallScore, suggestedRating } from './performance-scoring';

describe('performance scoring', () => {
  it('requires whole goal weights adding up to 100%', () => {
    expect(goalWeightProblem([50, 30, 20])).toBeNull();
    expect(goalWeightProblem([])).toBe('Add at least one goal');
    expect(goalWeightProblem([60, 30])).toMatch(/add up to 90%/);
    expect(goalWeightProblem([50.5, 49.5])).toMatch(/between 1% and 100%/);
  });

  it('weights goal ratings and averages competencies', () => {
    expect(goalScore([{ weight: 50, rating: 4 }, { weight: 30, rating: 3 }, { weight: 20, rating: 5 }])).toBe(3.9);
    expect(goalScore([{ weight: 50, rating: 4 }, { weight: 50, rating: null }])).toBeNull();
    expect(competencyScore([4, 3, 3])).toBe(3.33);
    expect(competencyScore([4, null])).toBeNull();
  });

  it('combines goals and competencies by the cycle weighting', () => {
    expect(overallScore(3.9, 3.33, 70, true)).toBe(3.73);
    expect(overallScore(3.9, null, 70, false)).toBe(3.9);
    expect(overallScore(3.9, 3.33, 100, true)).toBe(3.9);
    expect(overallScore(null, 3.33, 0, true)).toBe(3.33);
    expect(overallScore(3.9, null, 70, true)).toBeNull();
  });

  it('suggests the nearest rating (half up) and counts the distribution', () => {
    expect([suggestedRating(3.49), suggestedRating(3.5), suggestedRating(4.99), suggestedRating(null)]).toEqual([3, 4, 5, null]);
    expect(distribution([3, 3, 4, null, 5, 1])).toEqual({ 1: 1, 2: 0, 3: 2, 4: 1, 5: 1 });
  });
});
