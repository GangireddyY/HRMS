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

/** Skill matrix. */
export const SKILL_CATEGORIES = ['TECHNICAL', 'TOOL', 'DOMAIN', 'SOFT', 'LANGUAGE', 'OTHER'] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];
/** Proficiency 1–5. */
export const SKILL_LEVELS = [1, 2, 3, 4, 5] as const;
export const SKILL_LEVEL_LABELS: Record<number, string> = { 1: 'Beginner', 2: 'Basic', 3: 'Intermediate', 4: 'Advanced', 5: 'Expert' };
/** A verified level comes from a manager / HR or from completing a course that teaches the skill. */
export const SKILL_VERIFIED_SOURCES = ['MANAGER', 'TRAINING'] as const;
export type SkillVerifiedSource = (typeof SKILL_VERIFIED_SOURCES)[number];
export const MAX_SKILLS_PER_ROLE = 40;
export const MATRIX_MAX_SKILLS = 25;
