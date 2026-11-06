/**
 * Benefit plans (group health, life and accident cover, wellness, meal and transport benefits), eligibility,
 * enrolment windows and dependants. Employee contributions are deducted through payroll.
 */

export const BENEFIT_TYPES = ['HEALTH', 'LIFE', 'ACCIDENT', 'WELLNESS', 'MEAL', 'TRANSPORT', 'OTHER'] as const;
export type BenefitType = (typeof BENEFIT_TYPES)[number];

/** DRAFT (being set up) → ACTIVE (employees enrol) → ARCHIVED (coverage ended; read-only). */
export const BENEFIT_PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type BenefitPlanStatus = (typeof BENEFIT_PLAN_STATUSES)[number];

/** Family members a coverage option can include (from the employee's family details). */
export const DEPENDENT_RELATIONS = ['SPOUSE', 'CHILD', 'FATHER', 'MOTHER'] as const;
export type DependentRelation = (typeof DEPENDENT_RELATIONS)[number];

/**
 * PENDING (waiting for HR approval) → ACTIVE → ENDED; PENDING → REJECTED / CANCELLED.
 * WAIVED records that the employee declined a plan.
 */
export const BENEFIT_ENROLLMENT_STATUSES = ['PENDING', 'ACTIVE', 'WAIVED', 'REJECTED', 'CANCELLED', 'ENDED'] as const;
export type BenefitEnrollmentStatus = (typeof BENEFIT_ENROLLMENT_STATUSES)[number];
export const LIVE_BENEFIT_STATUSES: readonly BenefitEnrollmentStatus[] = ['PENDING', 'ACTIVE', 'WAIVED'];

/** Why the employee could enrol: the open enrolment window, joining, a life event, or enrolled by HR. */
export const BENEFIT_ENROLLMENT_REASONS = ['OPEN_ENROLLMENT', 'NEW_JOINER', 'LIFE_EVENT', 'HR'] as const;
export type BenefitEnrollmentReason = (typeof BENEFIT_ENROLLMENT_REASONS)[number];

export const LIFE_EVENTS = ['MARRIAGE', 'CHILDBIRTH', 'ADOPTION', 'DIVORCE', 'DEATH_OF_DEPENDENT', 'LOSS_OF_OTHER_COVER'] as const;
export type LifeEvent = (typeof LIFE_EVENTS)[number];

/** New joiners enrol within this many days of becoming eligible. */
export const NEW_JOINER_WINDOW_DAYS = 30;
/** Changes after a life event are requested within this many days of it. */
export const LIFE_EVENT_WINDOW_DAYS = 30;
export const MAX_PLAN_OPTIONS = 10;
