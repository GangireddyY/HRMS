import type { Competency, CycleStatus, FeedbackStatus, PipObjective, PipProgress, PipStatus, ReviewStage } from '@contracts';

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface Cycle {
  id: string;
  name: string;
  description: string | null;
  periodStart: string;
  periodEnd: string;
  goalsDue: string | null;
  selfReviewDue: string | null;
  managerReviewDue: string | null;
  goalsWeight: number;
  competencies: Competency[];
  ratingLabels: string[];
  eligibilityCutoff: string | null;
  departmentIds: string[] | null;
  status: CycleStatus;
  launchedAt: string | null;
  resultsReleasedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  stages: Record<ReviewStage, number>;
}

export interface CycleDetail extends Cycle {
  departments: { id: string; name: string }[];
  participants: number;
  withoutReviewer: number;
  distribution: Record<number, number>;
  calibrated: number;
  launchedFor?: number;
}

export interface CycleInput {
  name: string;
  description?: string | null;
  periodStart: string;
  periodEnd: string;
  goalsDue?: string | null;
  selfReviewDue?: string | null;
  managerReviewDue?: string | null;
  goalsWeight?: number;
  competencies?: { key: string; name: string; description?: string | null }[];
  ratingLabels?: string[];
  eligibilityCutoff?: string | null;
  departmentIds?: string[] | null;
}

export interface ReviewRow {
  id: string;
  cycle: { id: string; name: string; status: CycleStatus; resultsReleased: boolean };
  employee: PersonRef & { department: string | null; designation: string | null };
  reviewer: PersonRef | null;
  stage: ReviewStage;
  goals: number;
  overallScore: number | null;
  finalRating: number | null;
  calibrated: boolean;
  due: string | null;
}

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  measure: string | null;
  weight: number;
  dueDate: string | null;
  progress: number;
  progressNote: string | null;
  selfRating: number | null;
  selfComment: string | null;
  managerRating: number | null;
  managerComment: string | null;
}

export interface CompetencyRating {
  key: string;
  rating: number | null;
  comment: string | null;
}

export interface ReviewDetail {
  id: string;
  cycle: {
    id: string;
    name: string;
    status: CycleStatus;
    periodStart: string;
    periodEnd: string;
    goalsDue: string | null;
    selfReviewDue: string | null;
    managerReviewDue: string | null;
    goalsWeight: number;
    competencies: Competency[];
    ratingLabels: string[];
    resultsReleased: boolean;
  };
  employee: PersonRef & { department: string | null; designation: string | null };
  reviewer: PersonRef | null;
  stage: ReviewStage;
  goalsSubmittedAt: string | null;
  goalsApprovedAt: string | null;
  goalsReturnNote: string | null;
  goals: Goal[];
  self: { competencies: CompetencyRating[]; comment: string | null; submittedAt: string | null };
  manager: {
    competencies: CompetencyRating[];
    comment: string | null;
    strengths: string | null;
    improvements: string | null;
    submittedAt: string | null;
    goalScore: number | null;
    competencyScore: number | null;
    overallScore: number | null;
    finalRating: number | null;
    calibratedRating: number | null;
    calibrationNote: string | null;
    rating: number | null;
  } | null;
  acknowledgedAt: string | null;
  employeeResponse: string | null;
  feedback: { id: string; giver: PersonRef | null; status: FeedbackStatus; rating: number | null; strengths: string | null; improvements: string | null; submittedAt: string | null }[];
  feedbackRequested: number;
  viewer: { isSubject: boolean; isReviewer: boolean; isHr: boolean };
  permissions: {
    editGoals: boolean;
    submitGoals: boolean;
    approveGoals: boolean;
    returnGoals: boolean;
    updateProgress: boolean;
    selfAssess: boolean;
    managerAssess: boolean;
    submitManagerReview: boolean;
    requestFeedback: boolean;
    calibrate: boolean;
    acknowledge: boolean;
    reassign: boolean;
  };
}

export interface GoalInput {
  title: string;
  description?: string | null;
  measure?: string | null;
  weight: number;
  dueDate?: string | null;
}

export interface AssessmentInput {
  goals: { goalId: string; rating: number | null; comment: string | null }[];
  competencies: CompetencyRating[];
  comment: string | null;
  submit: boolean;
  strengths?: string | null;
  improvements?: string | null;
  finalRating?: number | null;
}

export interface FeedbackRequest {
  id: string;
  status: FeedbackStatus;
  open: boolean;
  subject: PersonRef;
  cycle: { id: string; name: string };
  rating: number | null;
  strengths: string | null;
  improvements: string | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface Colleague extends PersonRef {
  department: string | null;
  designation: string | null;
}

export interface PipRow {
  id: string;
  employee: PersonRef & { department: string | null };
  owner: PersonRef | null;
  startDate: string;
  endDate: string;
  status: PipStatus;
  overdue: boolean;
  objectivesCount: number;
  acknowledged: boolean;
  createdAt: string;
}

export interface PipDetail extends PipRow {
  reason: string;
  objectives: PipObjective[];
  reviewId: string | null;
  outcomeNote: string | null;
  closedAt: string | null;
  closedBy: string | null;
  createdBy: string | null;
  acknowledgedAt: string | null;
  employeeComment: string | null;
  checkIns: { id: string; checkInDate: string; progress: PipProgress; note: string; createdBy: string | null; createdAt: string }[];
  permissions: { manage: boolean; acknowledge: boolean };
}

export interface PipInput {
  employeeId: string;
  reviewId?: string | null;
  reason: string;
  objectives: { title: string; measure?: string | null }[];
  startDate: string;
  endDate: string;
}
