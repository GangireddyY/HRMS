/** Training & development: courses, sessions, enrolments and assignments, assessments and certificates. */

export const COURSE_CATEGORIES = ['TECHNICAL', 'SOFT_SKILLS', 'LEADERSHIP', 'COMPLIANCE', 'ONBOARDING', 'SAFETY', 'OTHER'] as const;
export type CourseCategory = (typeof COURSE_CATEGORIES)[number];

/** CLASSROOM and VIRTUAL courses run as dated sessions; SELF_PACED courses are taken any time (content link). */
export const COURSE_DELIVERIES = ['CLASSROOM', 'VIRTUAL', 'SELF_PACED'] as const;
export type CourseDelivery = (typeof COURSE_DELIVERIES)[number];

export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * ENROLLED → IN_PROGRESS → COMPLETED once every requirement is met (session attended, assessment passed, or a
 * self-paced course marked done). FAILED when assessment attempts run out, NO_SHOW when a session was missed.
 */
export const ENROLLMENT_STATUSES = ['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_SHOW', 'CANCELLED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
/** Enrolments that block another enrolment in the same course. */
export const OPEN_ENROLLMENT_STATUSES: readonly EnrollmentStatus[] = ['ENROLLED', 'IN_PROGRESS'];

export const ENROLLMENT_SOURCES = ['SELF', 'ASSIGNED'] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

export const MAX_QUESTIONS_PER_COURSE = 50;
export const MAX_OPTIONS_PER_QUESTION = 6;
export const MAX_ASSIGN_AT_ONCE = 500;
/** Certifications expiring within this many days are flagged. */
export const CERTIFICATION_WARNING_DAYS = 30;
