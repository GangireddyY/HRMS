/** Performance: review cycles, goals, self / manager reviews, 360 feedback, calibration and improvement plans. */

/** DRAFT (being configured) → ACTIVE (reviews in progress) → CLOSED (read-only). */
export const CYCLE_STATUSES = ['DRAFT', 'ACTIVE', 'CLOSED'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

/**
 * One employee's review in a cycle:
 *  GOAL_SETTING → GOAL_APPROVAL (employee submitted goals) → SELF_REVIEW (goals approved; progress tracked, self-assessment)
 *  → MANAGER_REVIEW → COMPLETED (manager rated; visible to the employee once results are released) → ACKNOWLEDGED.
 */
export const REVIEW_STAGES = ['GOAL_SETTING', 'GOAL_APPROVAL', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETED', 'ACKNOWLEDGED'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

export const FEEDBACK_STATUSES = ['REQUESTED', 'SUBMITTED', 'DECLINED'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** ACTIVE → SUCCESSFUL / UNSUCCESSFUL (outcome recorded) or CANCELLED. */
export const PIP_STATUSES = ['ACTIVE', 'SUCCESSFUL', 'UNSUCCESSFUL', 'CANCELLED'] as const;
export type PipStatus = (typeof PIP_STATUSES)[number];

export const PIP_PROGRESS = ['ON_TRACK', 'SOME_PROGRESS', 'OFF_TRACK'] as const;
export type PipProgress = (typeof PIP_PROGRESS)[number];

export interface PipObjective {
  title: string;
  measure: string | null;
  /** Set when the plan is closed. */
  met: boolean | null;
}

export const RATING_MIN = 1;
export const RATING_MAX = 5;
/** Labels for ratings 1–5 (a cycle may rename them). */
export const DEFAULT_RATING_LABELS = ['Needs improvement', 'Partially meets expectations', 'Meets expectations', 'Exceeds expectations', 'Outstanding'];

export interface Competency {
  key: string;
  name: string;
  description: string | null;
}

/** Suggested competencies offered when a cycle is created (editable per cycle). */
export const SUGGESTED_COMPETENCIES: readonly Competency[] = [
  { key: 'job-knowledge', name: 'Job knowledge', description: 'Skills and expertise needed for the role, kept up to date.' },
  { key: 'quality', name: 'Quality of work', description: 'Accurate, thorough and reliable output.' },
  { key: 'communication', name: 'Communication', description: 'Clear, timely and respectful in writing and speech.' },
  { key: 'collaboration', name: 'Collaboration', description: 'Works well with others and shares knowledge.' },
  { key: 'ownership', name: 'Ownership', description: 'Takes responsibility and follows through.' },
];

export const MAX_GOALS_PER_REVIEW = 15;
export const MAX_FEEDBACK_REQUESTS_PER_REVIEW = 10;
