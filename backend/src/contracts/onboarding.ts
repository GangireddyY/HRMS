/** Onboarding and probation vocabularies shared by the API and the web app. */

/** Who completes a checklist task: the new joiner, their manager, or HR (onboarding.manage). */
export const ONBOARDING_ASSIGNEES = ['EMPLOYEE', 'MANAGER', 'HR'] as const;
export type OnboardingAssignee = (typeof ONBOARDING_ASSIGNEES)[number];

export const ONBOARDING_CASE_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type OnboardingCaseStatus = (typeof ONBOARDING_CASE_STATUSES)[number];

/** Stored task states; document tasks additionally show SUBMITTED / REJECTED from their document. */
export const ONBOARDING_TASK_STATUSES = ['PENDING', 'DONE', 'SKIPPED'] as const;
export type OnboardingTaskStatus = (typeof ONBOARDING_TASK_STATUSES)[number];
export type OnboardingTaskState = OnboardingTaskStatus | 'SUBMITTED' | 'REJECTED';

export const PROBATION_RECOMMENDATIONS = ['CONFIRM', 'EXTEND'] as const;
export type ProbationRecommendation = (typeof PROBATION_RECOMMENDATIONS)[number];

export const PROBATION_REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ProbationReviewStatus = (typeof PROBATION_REVIEW_STATUSES)[number];

/** Joiners who started within this many days (or will start) without a case are suggested for onboarding. */
export const ONBOARDING_JOINER_WINDOW_DAYS = 90;
/** Longest probation extension in one review. */
export const PROBATION_MAX_EXTENSION_DAYS = 365;

/**
 * Starting checklist offered to new organizations (created only when an administrator chooses to).
 * `dueOffsetDays` is relative to the date of joining (negative = before joining).
 */
export const RECOMMENDED_ONBOARDING_TASKS = [
  { title: 'Issue the appointment letter', assignee: 'HR', dueOffsetDays: -7, description: 'Share the signed appointment letter and joining instructions.' },
  { title: 'Set up laptop, email and system access', assignee: 'HR', dueOffsetDays: -2, description: 'Coordinate with IT so everything works on day one.' },
  { title: 'Plan the first week', assignee: 'MANAGER', dueOffsetDays: -2, description: 'Introductions, goals for the first 30 days and a buddy.' },
  { title: 'Upload PAN card', assignee: 'EMPLOYEE', dueOffsetDays: 0, documentCategory: 'IDENTITY' },
  { title: 'Upload Aadhaar card', assignee: 'EMPLOYEE', dueOffsetDays: 0, documentCategory: 'IDENTITY' },
  { title: 'Upload address proof', assignee: 'EMPLOYEE', dueOffsetDays: 3, documentCategory: 'ADDRESS' },
  { title: 'Upload highest education certificate', assignee: 'EMPLOYEE', dueOffsetDays: 7, documentCategory: 'EDUCATION' },
  { title: 'Upload relieving letter from the previous employer', assignee: 'EMPLOYEE', dueOffsetDays: 7, documentCategory: 'EXPERIENCE', isRequired: false },
  { title: 'Complete your profile (family, education, emergency contact)', assignee: 'EMPLOYEE', dueOffsetDays: 3 },
  { title: 'Record bank, PAN and UAN details', assignee: 'HR', dueOffsetDays: 5, description: 'Needed before the first payroll run.' },
  { title: 'Induction and policy walkthrough', assignee: 'HR', dueOffsetDays: 1 },
  { title: '30-day check-in', assignee: 'MANAGER', dueOffsetDays: 30 },
] as const;
