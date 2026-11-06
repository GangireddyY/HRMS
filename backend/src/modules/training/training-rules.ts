/** Pure training rules (no database): assessment scoring, completion requirements and certificate expiry. */

export interface Question {
  id: string;
  correctIndex: number;
  optionCount: number;
}

export interface AttemptResult {
  correct: number;
  total: number;
  /** Whole percentage. */
  score: number;
  passed: boolean;
}

/** Scores answers (question id → chosen option index); unanswered or out-of-range answers count as wrong. */
export function scoreAttempt(questions: Question[], answers: Record<string, number>, passMark: number): AttemptResult {
  const total = questions.length;
  const correct = questions.filter((q) => {
    const a = answers[q.id];
    return Number.isInteger(a) && a! >= 0 && a! < q.optionCount && a === q.correctIndex;
  }).length;
  const score = total ? Math.round((correct / total) * 100) : 0;
  return { correct, total, score, passed: total > 0 && score >= passMark };
}

export interface CompletionState {
  /** Course runs as sessions (classroom / virtual). */
  sessionBased: boolean;
  attended: boolean;
  hasAssessment: boolean;
  passed: boolean;
  /** Self-paced without assessment: the learner confirmed they finished. */
  markedDone: boolean;
}

/** Requirements still open before an enrolment completes (empty = complete). */
export function missingRequirements(s: CompletionState): string[] {
  const missing: string[] = [];
  if (s.sessionBased && !s.attended) missing.push('Attend the session');
  if (s.hasAssessment && !s.passed) missing.push('Pass the assessment');
  if (!s.sessionBased && !s.hasAssessment && !s.markedDone) missing.push('Mark the course as done');
  return missing;
}

/** Date a certification expires: `validityMonths` after completion (clamped to the month's last day); null = never. */
export function certificateExpiry(completedOn: string, validityMonths: number | null): string | null {
  if (!validityMonths) return null;
  const [y, m, d] = completedOn.split('-').map(Number) as [number, number, number];
  const total = m - 1 + validityMonths;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export type CertificationState = 'VALID' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

export function certificationState(expiresOn: string | null, today: string, warningDays: number): CertificationState {
  if (!expiresOn) return 'NO_EXPIRY';
  if (expiresOn < today) return 'EXPIRED';
  const warn = new Date(`${today}T00:00:00Z`);
  warn.setUTCDate(warn.getUTCDate() + warningDays);
  return expiresOn <= warn.toISOString().slice(0, 10) ? 'EXPIRING' : 'VALID';
}
