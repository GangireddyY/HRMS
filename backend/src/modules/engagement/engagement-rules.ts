import type { SurveyQuestionType } from '../../contracts';

/** Pure engagement rules (no database): audience matching, answer validation and survey results. */

export interface Audience {
  departmentIds: string[] | null;
  locationIds: string[] | null;
}

/** Empty / null lists mean "everyone"; otherwise the employee must match every list that is set. */
export function inAudience(a: Audience, employee: { departmentId: string | null; locationId: string | null }): boolean {
  if (a.departmentIds?.length && (!employee.departmentId || !a.departmentIds.includes(employee.departmentId))) return false;
  if (a.locationIds?.length && (!employee.locationId || !a.locationIds.includes(employee.locationId))) return false;
  return true;
}

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
  required: boolean;
}

export type AnswerValue = number | string;

/** Cleans answers to the survey's questions; returns problems (missing required answers, invalid values). */
export function validateAnswers(questions: SurveyQuestion[], raw: Record<string, unknown>): { answers: Record<string, AnswerValue>; problems: string[] } {
  const answers: Record<string, AnswerValue> = {};
  const problems: string[] = [];
  questions.forEach((q, i) => {
    const v = raw[q.id];
    const label = `Question ${i + 1}`;
    if (v === undefined || v === null || v === '') {
      if (q.required) problems.push(`${label} needs an answer`);
      return;
    }
    if (q.type === 'TEXT') {
      if (typeof v !== 'string') return problems.push(`${label}: enter text`);
      const text = v.trim().slice(0, 2000);
      if (text) answers[q.id] = text;
      else if (q.required) problems.push(`${label} needs an answer`);
      return;
    }
    const n = typeof v === 'number' ? v : Number.NaN;
    const [min, max] = q.type === 'RATING' ? [1, 5] : q.type === 'NPS' ? [0, 10] : [0, q.options.length - 1];
    if (!Number.isInteger(n) || n < min || n > max) return problems.push(`${label}: choose a valid answer`);
    answers[q.id] = n;
  });
  return { answers, problems };
}

export interface QuestionResult {
  questionId: string;
  type: SurveyQuestionType;
  prompt: string;
  answered: number;
  /** RATING / NPS: average; NPS also the eNPS score (−100…100). */
  average?: number | null;
  nps?: { score: number | null; promoters: number; passives: number; detractors: number };
  /** RATING (1–5), NPS (0–10) or CHOICE (option index) → count. */
  distribution?: Record<number, number>;
  options?: string[];
  /** TEXT answers (shuffled order is the caller's job if needed). */
  texts?: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** eNPS = % promoters (9–10) − % detractors (0–6), rounded to a whole number. */
export function npsScore(values: number[]): { score: number | null; promoters: number; passives: number; detractors: number } {
  const promoters = values.filter((v) => v >= 9).length;
  const detractors = values.filter((v) => v <= 6).length;
  const passives = values.length - promoters - detractors;
  return { score: values.length ? Math.round(((promoters - detractors) / values.length) * 100) : null, promoters, passives, detractors };
}

export function surveyResults(questions: SurveyQuestion[], responses: Record<string, AnswerValue>[]): QuestionResult[] {
  return questions.map((q) => {
    const values = responses.map((r) => r[q.id]).filter((v) => v !== undefined);
    const base: QuestionResult = { questionId: q.id, type: q.type, prompt: q.prompt, answered: values.length };
    if (q.type === 'TEXT') return { ...base, texts: values.map(String) };
    const nums = values.filter((v): v is number => typeof v === 'number');
    const [min, max] = q.type === 'RATING' ? [1, 5] : q.type === 'NPS' ? [0, 10] : [0, q.options.length - 1];
    const distribution: Record<number, number> = {};
    for (let k = min; k <= max; k++) distribution[k] = 0;
    for (const v of nums) if (v in distribution) distribution[v]! += 1;
    if (q.type === 'CHOICE') return { ...base, distribution, options: q.options };
    const average = nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    return { ...base, distribution, average, ...(q.type === 'NPS' ? { nps: npsScore(nums) } : {}) };
  });
}
