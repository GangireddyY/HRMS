import type {
  Competency,
  CycleStatus,
  FeedbackStatus,
  HikeStatus,
  MeritGuideline,
  OkrHealth,
  OkrLevel,
  OkrMetric,
  OkrStatus,
  OneOnOneItemKind,
  OneOnOneStatus,
  PipObjective,
  PipProgress,
  PipStatus,
  ReviewStage,
} from '@contracts';

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
  targetDistribution: number[] | null;
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
  targetDistribution?: number[] | null;
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
    potential?: number | null;
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
    setPotential?: boolean;
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

export interface Compensation {
  cycle: { id: string; name: string; status: CycleStatus; ratingLabels: string[] };
  configured: boolean;
  meritMatrix: MeritGuideline[];
  budgetPercent: number | null;
  effectiveFrom: string | null;
  counts: Record<HikeStatus, number>;
  /** Only with organisation-wide salary access. */
  budget: { base: number; pool: number | null; recommended: number; approved: number; remaining: number | null; averagePercent: number } | null;
  permissions: { configure: boolean; decide: boolean; apply: boolean };
}

export interface CompensationInput {
  meritMatrix: MeritGuideline[];
  budgetPercent?: number | null;
  effectiveFrom?: string | null;
}

export interface HikeRow {
  reviewId: string;
  employee: PersonRef & { department: string | null; designation: string | null };
  rating: number;
  ratingLabel: string | null;
  guideline: MeritGuideline;
  /** Undefined when the viewer can't see this employee's salary. */
  currentCtc?: number | null;
  recommendation: {
    id: string;
    percent: number;
    newCtc?: number | null;
    promotion: boolean;
    justification: string | null;
    status: HikeStatus;
    outsideGuideline: boolean;
    recommendedBy: string | null;
    submittedAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    appliedAt: string | null;
  } | null;
  permissions: { edit: boolean; decide: boolean };
}

export interface HikeList {
  cycle: { id: string; name: string; status?: CycleStatus; effectiveFrom?: string | null; configured?: boolean };
  rows: HikeRow[];
}

export interface HikeInput {
  percent: number;
  promotion?: boolean;
  justification?: string | null;
}

export interface PipInput {
  employeeId: string;
  reviewId?: string | null;
  reason: string;
  objectives: { title: string; measure?: string | null }[];
  startDate: string;
  endDate: string;
}

// ---- OKRs ------------------------------------------------------------------------------------------

export interface KeyResult {
  id: string;
  title: string;
  metric: OkrMetric;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string | null;
  weight: number;
  progress: number;
  lastCheckInAt: string | null;
  checkIns?: { id: string; value: number; health: OkrHealth; note: string | null; by: string | null; createdAt: string }[];
}

export interface Objective {
  id: string;
  title: string;
  description: string | null;
  level: OkrLevel;
  owner: PersonRef | null;
  department: { id: string; name: string | null } | null;
  ownerDepartment: string | null;
  parentId: string | null;
  periodStart: string;
  periodEnd: string;
  status: OkrStatus;
  progress: number;
  health: OkrHealth | null;
  keyResults: KeyResult[];
  updatedAt: string;
  canEdit?: boolean;
}

export interface ObjectiveDetail extends Objective {
  parent: { id: string; title: string; level: OkrLevel; progress: number; health: OkrHealth | null; status: OkrStatus } | null;
  children: Objective[];
  canEdit: boolean;
}

export interface OkrList {
  date: string;
  selfEmployeeId: string | null;
  objectives: (Objective & { canEdit: boolean })[];
  summary: { total: number; averageProgress: number; onTrack: number; atRisk: number; offTrack: number; noCheckIn: number };
  can: { company: boolean; department: boolean; departmentId: string | null; individual: boolean; forOthers: boolean };
}

export interface KeyResultInput {
  title: string;
  metric: OkrMetric;
  startValue?: number;
  targetValue?: number;
  unit?: string | null;
  weight?: number;
}

export interface ObjectiveInput {
  title: string;
  description?: string | null;
  level: OkrLevel;
  ownerEmployeeId?: string | null;
  departmentId?: string | null;
  parentId?: string | null;
  periodStart: string;
  periodEnd: string;
  keyResults?: KeyResultInput[];
}

// ---- 1:1s ------------------------------------------------------------------------------------------

export interface OneOnOneRow {
  id: string;
  manager: PersonRef;
  employee: PersonRef & { department: string | null };
  scheduledAt: string;
  durationMinutes: number;
  status: OneOnOneStatus;
  overdue: boolean;
  topics: number;
  openActions: number;
}

export interface OneOnOneItem {
  id: string;
  kind: OneOnOneItemKind;
  text: string;
  owner: { id: string; name: string | null } | null;
  dueDate: string | null;
  done: boolean;
  doneAt: string | null;
  addedByMe: boolean;
  createdAt: string;
}

export interface OneOnOneDetail extends Omit<OneOnOneRow, 'topics' | 'openActions'> {
  sharedNotes: string | null;
  managerNotes: string | null;
  completedAt: string | null;
  items: OneOnOneItem[];
  previous: { id: string; scheduledAt: string } | null;
  viewer: { isManager: boolean; isEmployee: boolean };
  permissions: { reschedule: boolean; editNotes: boolean; addItems: boolean; complete: boolean; cancel: boolean };
  next?: { id: string; scheduledAt: string } | null;
}

export interface OneOnOneTeamRow {
  employee: PersonRef & { department: string | null };
  last: { id: string; at: string } | null;
  next: { id: string; at: string; overdue: boolean } | null;
  daysSinceLast: number | null;
}

// ---- Calibration -----------------------------------------------------------------------------------

export interface CalibrationPerson {
  reviewId: string;
  employee: PersonRef & { department: string | null };
  reviewer: PersonRef | null;
  finalRating: number | null;
  calibratedRating: number | null;
  calibrationNote: string | null;
  rating: number | null;
  potential: number | null;
  box: { performance: number; potential: number; label: string } | null;
}

export interface Calibration {
  cycle: { id: string; name: string; status: CycleStatus; ratingLabels: string[]; resultsReleasedAt: string | null };
  targetDistribution: number[];
  targetIsCustom: boolean;
  rated: number;
  pending: number;
  withoutPotential: number;
  distribution: { rating: number; label: string; count: number; percent: number; target: number; expected: number; gap: number }[];
  nineBox: { performance: number; potential: number; label: string; count: number }[];
  people: CalibrationPerson[];
  canCalibrate: boolean;
}
