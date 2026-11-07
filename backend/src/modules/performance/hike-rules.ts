import { DEFAULT_MERIT_MATRIX, type MeritGuideline } from '../../contracts';

/** The guideline for a rating (the default matrix when the cycle has none for it). */
export function guidelineFor(matrix: readonly MeritGuideline[] | null | undefined, rating: number): MeritGuideline {
  return (matrix ?? DEFAULT_MERIT_MATRIX).find((g) => g.rating === rating) ?? DEFAULT_MERIT_MATRIX.find((g) => g.rating === rating) ?? { rating, min: 0, target: 0, max: 0 };
}

export const outsideGuideline = (percent: number, g: MeritGuideline) => percent < g.min || percent > g.max;

/** The new annual CTC after a percentage increase, rounded to the rupee. */
export const increasedCtc = (current: number, percent: number) => Math.round(current * (1 + percent / 100));

/** Problems with a merit matrix: one row per rating 1–5 with 0 ≤ min ≤ target ≤ max ≤ 100. */
export function matrixProblems(matrix: MeritGuideline[]): string[] {
  const problems: string[] = [];
  for (let rating = 1; rating <= 5; rating++) {
    const rows = matrix.filter((g) => g.rating === rating);
    if (rows.length !== 1) {
      problems.push(`Give exactly one guideline for rating ${rating}`);
      continue;
    }
    const g = rows[0]!;
    if (g.min < 0 || g.max > 100 || g.min > g.target || g.target > g.max) problems.push(`Rating ${rating}: keep 0 ≤ minimum ≤ target ≤ maximum ≤ 100`);
  }
  return problems;
}

export interface BudgetLine {
  currentCtc: number | null;
  newCtc: number | null;
  status: string;
}

/** The pool (budget % of the current CTC of everyone with a recommendation) and how much of it is used. */
export function budgetUse(lines: BudgetLine[], budgetPercent: number | null) {
  const base = lines.reduce((s, l) => s + (l.currentCtc ?? 0), 0);
  const increase = (statuses: string[]) => lines.filter((l) => statuses.includes(l.status)).reduce((s, l) => s + Math.max(0, (l.newCtc ?? 0) - (l.currentCtc ?? 0)), 0);
  const pool = budgetPercent === null ? null : Math.round((base * budgetPercent) / 100);
  const recommended = increase(['DRAFT', 'SUBMITTED', 'APPROVED', 'APPLIED']);
  const approved = increase(['APPROVED', 'APPLIED']);
  return { base, pool, recommended, approved, remaining: pool === null ? null : pool - approved, averagePercent: base ? Math.round((recommended / base) * 10000) / 100 : 0 };
}
