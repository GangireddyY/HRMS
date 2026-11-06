import type {
  ApplicationStage,
  CandidateSource,
  EmploymentType,
  FeedbackRecommendation,
  InterviewMode,
  InterviewStatus,
  JobStatus,
  OfferStatus,
  RequisitionReason,
  RequisitionStatus,
} from '@contracts';

export interface Ref {
  id: string;
  name: string;
}

export interface Requisition {
  id: string;
  code: string;
  title: string;
  department: Ref | null;
  designation: Ref | null;
  location: Ref | null;
  hiringManager: { id: string; name: string; employeeCode: string } | null;
  employmentType: EmploymentType;
  openings: number;
  hiredCount: number;
  reason: RequisitionReason;
  justification: string;
  budgetMin: number | null;
  budgetMax: number | null;
  targetDate: string | null;
  status: RequisitionStatus;
  requestedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  job: { id: string; status: JobStatus; pipeline: Partial<Record<ApplicationStage, number>> } | null;
  permissions: { edit: boolean; decide: boolean };
}

export interface RequisitionInput {
  title: string;
  departmentId?: string | null;
  designationId?: string | null;
  locationId?: string | null;
  hiringManagerId?: string | null;
  employmentType?: EmploymentType;
  openings?: number;
  reason: RequisitionReason;
  justification: string;
  budgetMin?: number | null;
  budgetMax?: number | null;
  targetDate?: string | null;
  submit?: boolean;
}

export interface Job {
  id: string;
  title: string;
  status: JobStatus;
  isPublic: boolean;
  closesOn: string | null;
  experienceMin: number | null;
  experienceMax: number | null;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  requisition: {
    id: string;
    code: string;
    status: RequisitionStatus;
    openings: number;
    hiredCount: number;
    employmentType: EmploymentType;
    department: Ref | null;
    designation: Ref | null;
    location: Ref | null;
    hiringManager: Ref | null;
  };
  pipeline: Partial<Record<ApplicationStage, number>>;
}

export interface JobDetail extends Job {
  description: string;
  requirements: string | null;
}

export interface JobInput {
  requisitionId: string;
  title?: string;
  description: string;
  requirements?: string | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  isPublic?: boolean;
  closesOn?: string | null;
}

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  experienceYears: number | null;
  currentCtc: number | null;
  expectedCtc: number | null;
  noticePeriodDays: number | null;
  location: string | null;
  linkedinUrl: string | null;
  source: CandidateSource;
  referredBy: Ref | null;
  notes: string | null;
  resume: { fileName: string; contentType: string; size: number; uploadedAt: string } | null;
  consentAt: string | null;
  createdAt: string;
  applications: { id: string; stage: ApplicationStage; stageChangedAt?: string; job: { id: string; title: string; status?: JobStatus } }[];
}

export type CandidateInput = Partial<Omit<Candidate, 'id' | 'name' | 'referredBy' | 'resume' | 'consentAt' | 'createdAt' | 'applications'>> & {
  firstName: string;
  lastName: string;
  email: string;
  referredById?: string | null;
  jobId?: string | null;
};

export interface ApplicationCard {
  id: string;
  stage: ApplicationStage;
  stageChangedAt: string;
  source: CandidateSource;
  job: { id: string; title: string };
  candidate: { id: string; name: string; email: string; phone: string | null; currentTitle: string | null; currentCompany: string | null; experienceYears: number | null; hasResume: boolean };
  interviews: number;
  nextInterviewAt: string | null;
  averageRating: number | null;
  feedbackCount: number;
}

export interface PanelMember {
  employee: { id: string; name: string; designation: string | null } | null;
  submittedAt: string | null;
  rating?: number | null;
  recommendation?: FeedbackRecommendation | null;
  feedback?: string | null;
}

export interface InterviewItem {
  id: string;
  roundName: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewMode;
  location: string | null;
  status: InterviewStatus;
  panel: PanelMember[];
}

export interface OfferSummary {
  id: string;
  status: OfferStatus;
  joiningDate: string;
  expiresOn: string | null;
  releasedAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  annualCtc?: number;
  designationId?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  notes?: string | null;
}

export interface ApplicationDetail {
  id: string;
  stage: ApplicationStage;
  stageChangedAt: string;
  source: CandidateSource;
  rejectionReason: string | null;
  hiredEmployeeId: string | null;
  createdAt: string;
  job: { id: string; title: string; status: JobStatus };
  candidate: Omit<Candidate, 'applications'>;
  events: { id: string; fromStage: ApplicationStage | null; toStage: ApplicationStage; note: string | null; createdAt: string; createdBy: string | null }[];
  interviews: InterviewItem[];
  offer: OfferSummary | null;
}

export interface MyInterview {
  id: string;
  roundName: string;
  scheduledAt: string;
  durationMinutes: number;
  mode: InterviewMode;
  location: string | null;
  status: InterviewStatus;
  candidate: { name: string; currentTitle: string | null; currentCompany: string | null; experienceYears: number | null; hasResume: boolean };
  job: { id: string; title: string };
  myFeedback: { rating: number; recommendation: FeedbackRecommendation; feedback: string; submittedAt: string } | null;
}

export interface OfferInput {
  designationId?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  annualCtc: number;
  joiningDate: string;
  expiresOn?: string | null;
  notes?: string | null;
}

export interface PublicJob {
  id: string;
  title: string;
  department: Ref | null;
  location: Ref | null;
  employmentType: EmploymentType;
  experienceMin: number | null;
  experienceMax: number | null;
  closesOn: string | null;
  postedAt: string | null;
}
