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

/**
 * Salary-hike recommendations after a review: DRAFT (reviewer working on it) → SUBMITTED → APPROVED / REJECTED (by
 * someone who revises salaries) → APPLIED (a salary revision from the cycle's effective date).
 */
export const HIKE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'APPLIED'] as const;
export type HikeStatus = (typeof HIKE_STATUSES)[number];

/** Increase guideline (% of the annual CTC) for a final rating. */
export interface MeritGuideline {
  rating: number;
  min: number;
  target: number;
  max: number;
}
export const DEFAULT_MERIT_MATRIX: readonly MeritGuideline[] = [
  { rating: 1, min: 0, target: 0, max: 0 },
  { rating: 2, min: 0, target: 2, max: 4 },
  { rating: 3, min: 4, target: 6, max: 8 },
  { rating: 4, min: 8, target: 10, max: 12 },
  { rating: 5, min: 12, target: 15, max: 20 },
];
export const MAX_HIKE_PERCENT = 100;

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
/** A common bell curve for ratings 1 → 5 (percent of people), offered as the calibration target. */
export const SUGGESTED_DISTRIBUTION = [5, 15, 50, 20, 10] as const;

/** Potential for the 9-box (with the rating as performance: 1–2 low, 3 medium, 4–5 high). */
export const POTENTIAL_LABELS: Record<1 | 2 | 3, string> = { 1: 'Low', 2: 'Medium', 3: 'High' };
/** 9-box cell names, by [performance band][potential band] (0 = low … 2 = high). */
export const NINE_BOX_LABELS: readonly (readonly string[])[] = [
  ['Underperformer', 'Inconsistent player', 'Rough diamond'],
  ['Effective', 'Core player', 'High potential'],
  ['Trusted professional', 'High performer', 'Star'],
];

// ---- OKRs ------------------------------------------------------------------------------------------

export const OKR_LEVELS = ['COMPANY', 'DEPARTMENT', 'INDIVIDUAL'] as const;
export type OkrLevel = (typeof OKR_LEVELS)[number];
export const OKR_STATUSES = ['ACTIVE', 'CLOSED', 'DROPPED'] as const;
export type OkrStatus = (typeof OKR_STATUSES)[number];
export const OKR_HEALTH = ['ON_TRACK', 'AT_RISK', 'OFF_TRACK'] as const;
export type OkrHealth = (typeof OKR_HEALTH)[number];
/** MILESTONE: done or not (target 1). */
export const OKR_METRICS = ['NUMBER', 'PERCENT', 'CURRENCY', 'MILESTONE'] as const;
export type OkrMetric = (typeof OKR_METRICS)[number];
export const OKR_MAX_KEY_RESULTS = 8;

// ---- 1:1s ------------------------------------------------------------------------------------------

export const ONE_ON_ONE_STATUSES = ['SCHEDULED', 'DONE', 'CANCELLED'] as const;
export type OneOnOneStatus = (typeof ONE_ON_ONE_STATUSES)[number];
export const ONE_ON_ONE_ITEM_KINDS = ['TOPIC', 'ACTION'] as const;
export type OneOnOneItemKind = (typeof ONE_ON_ONE_ITEM_KINDS)[number];

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

// ---- Succession planning ------------------------------------------------------------------------

export const SUCCESSION_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type SuccessionLevel = (typeof SUCCESSION_LEVELS)[number];
export const SUCCESSION_LEVEL_LABELS: Record<SuccessionLevel, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };
export const SUCCESSOR_READINESS = ['READY_NOW', 'ONE_TO_TWO_YEARS', 'THREE_PLUS_YEARS'] as const;
export type SuccessorReadiness = (typeof SUCCESSOR_READINESS)[number];
export const SUCCESSOR_READINESS_LABELS: Record<SuccessorReadiness, string> = { READY_NOW: 'Ready now', ONE_TO_TWO_YEARS: 'Ready in 1–2 years', THREE_PLUS_YEARS: 'Ready in 3+ years' };
export const MAX_SUCCESSORS_PER_PLAN = 10;
/** NONE: nobody named; AT_RISK: no one ready now; COVERED: at least one ready now. */
export type BenchStrength = 'NONE' | 'AT_RISK' | 'COVERED';

export interface SuccessorView {
  id: string;
  employee: { id: string; name: string; employeeCode: string; designation: string | null; department: string | null };
  readiness: SuccessorReadiness;
  rank: number;
  developmentNotes: string | null;
  /** From the latest completed review: final (calibrated) rating 1–5 and potential 1–3. */
  nineBox: { rating: number | null; potential: number | null; cycle: string | null };
}

export interface SuccessionPlanView {
  id: string;
  title: string;
  incumbent: { id: string; name: string; employeeCode: string; designation: string | null } | null;
  department: { id: string; name: string } | null;
  criticality: SuccessionLevel;
  riskOfLoss: SuccessionLevel;
  notes: string | null;
  reviewBy: string | null;
  bench: BenchStrength;
  successors: SuccessorView[];
  updatedAt: string;
  canManage: boolean;
}

// ---- Compensation budgets -----------------------------------------------------------------------

export interface CompensationPoolView {
  departmentId: string | null;
  department: string;
  /** Annual CTC of the department's people on the cycle's effective date. */
  currentPayroll: number;
  headcount: number;
  /** currentPayroll × the cycle's budget %, when set. */
  suggested: number | null;
  /** The pool; null = no pool set for this department. */
  amount: number | null;
  /** Increases recommended but not decided (draft or submitted). */
  planned: number;
  /** Increases approved or applied. */
  committed: number;
  /** amount − committed − planned (null without a pool). */
  remaining: number | null;
}

export const MAX_GOALS_PER_REVIEW = 15;
export const MAX_FEEDBACK_REQUESTS_PER_REVIEW = 10;
