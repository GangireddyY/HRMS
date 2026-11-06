import type { CourseCategory, CourseDelivery, CourseStatus, EnrollmentStatus } from '@contracts';
import type { CertificationState } from '../types';

export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  TECHNICAL: 'Technical',
  SOFT_SKILLS: 'Soft skills',
  LEADERSHIP: 'Leadership',
  COMPLIANCE: 'Compliance',
  ONBOARDING: 'Onboarding',
  SAFETY: 'Health & safety',
  OTHER: 'Other',
};
export const DELIVERY_LABELS: Record<CourseDelivery, string> = { CLASSROOM: 'Classroom', VIRTUAL: 'Virtual (live)', SELF_PACED: 'Self-paced' };
export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = { DRAFT: 'Draft', PUBLISHED: 'Published', ARCHIVED: 'Archived' };
export const courseTone: Record<CourseStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', PUBLISHED: 'success', ARCHIVED: 'warning' };

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  ENROLLED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  FAILED: 'Not passed',
  NO_SHOW: 'Missed session',
  CANCELLED: 'Cancelled',
};
export const enrollmentTone: Record<EnrollmentStatus, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  ENROLLED: 'neutral',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  FAILED: 'danger',
  NO_SHOW: 'warning',
  CANCELLED: 'neutral',
};
export const CERTIFICATION_LABELS: Record<CertificationState, string> = { VALID: 'Valid', EXPIRING: 'Expiring soon', EXPIRED: 'Expired', NO_EXPIRY: 'No expiry' };
export const certificationTone: Record<CertificationState, 'success' | 'warning' | 'danger' | 'neutral'> = { VALID: 'success', EXPIRING: 'warning', EXPIRED: 'danger', NO_EXPIRY: 'neutral' };

export const isSessionBasedDelivery = (d: CourseDelivery) => d !== 'SELF_PACED';
export const hours = (h: number | null) => (h === null ? null : `${h} h`);

const time = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
/** "Fri, 13 Nov 2026, 10:00 – 13:00". */
export function sessionWhen(s: { startsAt: string; endsAt: string }): string {
  const a = new Date(s.startsAt);
  const b = new Date(s.endsAt);
  return a.toDateString() === b.toDateString() ? `${time.format(a)} – ${timeOnly.format(b)}` : `${time.format(a)} – ${time.format(b)}`;
}
