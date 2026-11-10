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

/** Approval before release: required by the organization's setting, and always above the requisition's budget. */
export const OFFER_APPROVAL_STATUSES = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type OfferApprovalStatus = (typeof OFFER_APPROVAL_STATUSES)[number];

/** Documents candidates upload in the pre-joining portal. */
export const PREJOINING_DOCUMENT_CATEGORIES = ['IDENTITY', 'ADDRESS', 'EDUCATION', 'EXPERIENCE', 'CERTIFICATION', 'MEDICAL', 'OTHER'] as const;
export type PrejoiningDocumentCategory = (typeof PREJOINING_DOCUMENT_CATEGORIES)[number];
export const PREJOINING_MAX_DOCUMENTS = 15;

/** Placeholders the offer letter template can use, e.g. {{candidate_name}}. */
export const OFFER_LETTER_PLACEHOLDERS = {
  candidate_name: 'Full name of the candidate',
  candidate_first_name: 'First name',
  designation: 'Designation offered',
  department: 'Department',
  location: 'Work location',
  employment_type: 'Full time, contract…',
  annual_ctc: 'Annual cost to company (formatted)',
  joining_date: 'Date of joining',
  offer_expiry: 'Accept by',
  organization_name: 'Your organization',
  today: 'Date the offer is released',
} as const;

export const DEFAULT_OFFER_LETTER = {
  subject: 'Offer of employment – {{designation}}',
  body: `Dear {{candidate_first_name}},

We are delighted to offer you the position of **{{designation}}** in our {{department}} team at {{organization_name}}, based in {{location}}.

- Annual cost to company: **{{annual_ctc}}**
- Date of joining: **{{joining_date}}**
- Employment type: {{employment_type}}

Your detailed compensation structure, benefits and policies will be shared with you on joining. This offer is subject to satisfactory background and reference checks.

Please confirm your acceptance by signing below before {{offer_expiry}}.

We look forward to welcoming you.

Warm regards,
Human Resources, {{organization_name}}`,
};

/** Resumes: PDF or Word (.docx), detected from the file contents. */
export const RESUME_CONTENT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export type ResumeContentType = (typeof RESUME_CONTENT_TYPES)[number];
export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const CANDIDATE_SKILLS_MAX = 50;

/** Details read from a resume; anything not found is left out. */
export interface ParsedResume {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  currentTitle?: string;
  currentCompany?: string;
  experienceYears?: number;
  noticePeriodDays?: number;
  location?: string;
  linkedinUrl?: string;
  skills: string[];
}
