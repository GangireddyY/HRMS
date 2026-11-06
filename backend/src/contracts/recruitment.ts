/** Recruitment vocabularies shared by the API and the web app. */

export const REQUISITION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'FILLED'] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_REASONS = ['NEW_ROLE', 'REPLACEMENT', 'EXPANSION'] as const;
export type RequisitionReason = (typeof REQUISITION_REASONS)[number];

export const JOB_STATUSES = ['DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CANDIDATE_SOURCES = ['CAREERS', 'REFERRAL', 'JOB_BOARD', 'LINKEDIN', 'AGENCY', 'DIRECT', 'OTHER'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** Active pipeline stages in order, then the closed outcomes. HIRED is only reached by converting an accepted offer. */
export const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'] as const;
export const APPLICATION_STAGES = [...PIPELINE_STAGES, 'HIRED', 'REJECTED', 'WITHDRAWN'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const INTERVIEW_MODES = ['IN_PERSON', 'VIDEO', 'PHONE'] as const;
export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const INTERVIEW_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const FEEDBACK_RECOMMENDATIONS = ['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'] as const;
export type FeedbackRecommendation = (typeof FEEDBACK_RECOMMENDATIONS)[number];

export const OFFER_STATUSES = ['DRAFT', 'RELEASED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** Resumes: PDF or Word (.docx), detected from the file contents. */
export const RESUME_CONTENT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export type ResumeContentType = (typeof RESUME_CONTENT_TYPES)[number];
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
