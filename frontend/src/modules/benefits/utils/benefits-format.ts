import { INR_LOCALE } from '@/core/locale/locale';
import type { BenefitEnrollmentReason, BenefitEnrollmentStatus, BenefitPlanStatus, BenefitType, DependentRelation, LifeEvent } from '@contracts';

export const TYPE_LABELS: Record<BenefitType, string> = {
  HEALTH: 'Health insurance',
  LIFE: 'Life insurance',
  ACCIDENT: 'Accident insurance',
  WELLNESS: 'Wellness',
  MEAL: 'Meal benefit',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
};

export const PLAN_STATUS_LABELS: Record<BenefitPlanStatus, string> = { DRAFT: 'Draft', ACTIVE: 'Active', ARCHIVED: 'Archived' };
export const planTone: Record<BenefitPlanStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', ACTIVE: 'success', ARCHIVED: 'warning' };

export const ENROLLMENT_STATUS_LABELS: Record<BenefitEnrollmentStatus, string> = { PENDING: 'Pending approval', ACTIVE: 'Covered', WAIVED: 'Waived', REJECTED: 'Not approved', CANCELLED: 'Cancelled', ENDED: 'Ended' };
export const enrollmentTone: Record<BenefitEnrollmentStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  WAIVED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  ENDED: 'info',
};

export const REASON_LABELS: Record<BenefitEnrollmentReason, string> = { OPEN_ENROLLMENT: 'Open enrolment', NEW_JOINER: 'New joiner', LIFE_EVENT: 'Life event', HR: 'Enrolled by HR', RENEWAL: 'Carried over at renewal' };
export const LIFE_EVENT_LABELS: Record<LifeEvent, string> = {
  MARRIAGE: 'Marriage',
  CHILDBIRTH: 'Birth of a child',
  ADOPTION: 'Adoption',
  DIVORCE: 'Divorce',
  DEATH_OF_DEPENDENT: 'Death of a dependant',
  LOSS_OF_OTHER_COVER: 'Loss of other cover',
};
export const RELATION_LABELS: Record<DependentRelation, string> = { SPOUSE: 'Spouse', CHILD: 'Child', FATHER: 'Father', MOTHER: 'Mother' };

export const inr = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `₹${n.toLocaleString(INR_LOCALE, { maximumFractionDigits: 2 })}`);
