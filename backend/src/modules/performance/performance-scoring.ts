import { RATING_MAX, RATING_MIN } from '../../contracts';

/** Pure scoring rules for reviews (no database). */

export interface WeightedRating {
  weight: number;
  rating: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Goal weights must be whole percentages adding up to exactly 100. */
export function goalWeightProblem(weights: number[]): string | null {
  if (!weights.length) return 'Add at least one goal';
  if (weights.some((w) => !Number.isInteger(w) || w < 1 || w > 100)) return 'Each goal needs a weight between 1% and 100%';
  const total = weights.reduce((a, b) => a + b, 0);
  return total === 100 ? null : `Goal weights add up to ${total}%; they must add up to 100%`;
}

/** Weighted average of goal ratings (weights in %); null until every goal is rated. */
export function goalScore(goals: WeightedRating[]): number | null {
  if (!goals.length || goals.some((g) => g.rating === null)) return null;
  const total = goals.reduce((n, g) => n + g.weight, 0);
  return total ? round2(goals.reduce((n, g) => n + g.weight * g.rating!, 0) / total) : null;
}

/** Plain average of competency ratings; null until every competency is rated. */
export function competencyScore(ratings: (number | null)[]): number | null {
  if (!ratings.length || ratings.some((r) => r === null)) return null;
  return round2(ratings.reduce((n: number, r) => n + r!, 0) / ratings.length);
}

/**
 * Overall score: `goalsWeight`% from goals and the rest from competencies. Without competencies the goal score is the
 * overall score (and vice versa).
 */
export function overallScore(goals: number | null, competencies: number | null, goalsWeight: number, hasCompetencies: boolean): number | null {
  if (!hasCompetencies || goalsWeight === 100) return goals;
  if (goalsWeight === 0) return competencies;
  if (goals === null || competencies === null) return null;
  return round2((goals * goalsWeight + competencies * (100 - goalsWeight)) / 100);
}

/** Rating suggested for an overall score (half rounds up), within the scale. */
export function suggestedRating(score: number | null): number | null {
  if (score === null) return null;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, Math.floor(score + 0.5)));
}

export const isRating = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= RATING_MIN && (n as number) <= RATING_MAX;

/** Count of reviews per final rating (1–5), for calibration. */
export function distribution(ratings: (number | null)[]): Record<number, number> {
  const out: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of ratings) if (r !== null && isRating(r)) out[r]! += 1;
  return out;
}
