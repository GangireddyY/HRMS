import type {
  DocumentCategory,
  DocumentStatus,
  OnboardingAssignee,
  OnboardingCaseStatus,
  OnboardingTaskState,
  PaginationMeta,
  ProbationRecommendation,
  ProbationReviewStatus,
} from '@contracts';

export interface PersonRef {
  id: string;
  name: string;
  employeeCode: string;
}

export interface JoinerRef extends PersonRef {
  dateOfJoining: string;
  designation: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

export interface TemplateTask {
  id?: string;
  title: string;
  description: string | null;
  assignee: OnboardingAssignee;
  documentCategory: DocumentCategory | null;
  dueOffsetDays: number;
  isRequired: boolean;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  tasks: TemplateTask[];
  updatedAt: string;
}

export interface CaseProgress {
  total: number;
  done: number;
  requiredOpen: number;
  overdue: number;
  awaitingVerification: number;
}

export interface CaseSummary {
  id: string;
  status: OnboardingCaseStatus;
  joiningDate: string;
  progress: CaseProgress;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  employee: JoinerRef;
}

export interface OnboardingTask {
  id: string;
  title: string;
  description: string | null;
  assignee: OnboardingAssignee;
  documentCategory: DocumentCategory | null;
  dueDate: string;
  isRequired: boolean;
  state: OnboardingTaskState;
  overdue: boolean;
  note: string | null;
  completedAt: string | null;
  completedBy: string | null;
  document: { id: string; status: DocumentStatus; title: string; fileName: string; contentType: string; reviewNote: string | null; uploadedAt: string } | null;
}

export interface CaseDetail extends CaseSummary {
  manager: PersonRef | null;
  buddy: PersonRef | null;
  notes: string | null;
  cancelReason: string | null;
  tasks: OnboardingTask[];
  permissions: { manage: boolean; verify: boolean; isSelf: boolean; isManager: boolean };
}

export interface TeamTasks {
  caseId: string;
  joiningDate: string;
  employee: JoinerRef;
  tasks: OnboardingTask[];
}

export interface ProbationDue {
  employee: JoinerRef & { probationEndDate: string | null };
  probationEndDate: string;
  daysLeft: number;
  isDirectReport: boolean;
  pendingReview: { id: string; recommendation: ProbationRecommendation; submittedAt: string } | null;
}

export interface ProbationReview {
  id: string;
  employee: (JoinerRef & { probationEndDate: string | null }) | null;
  probationEndDate: string;
  recommendation: ProbationRecommendation;
  extendTo: string | null;
  comments: string;
  status: ProbationReviewStatus;
  submittedBy: string | null;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export type Paged<T> = { items: T[]; meta: PaginationMeta };
