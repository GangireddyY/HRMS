import type { ApplicationStage, CandidateSource, FeedbackRecommendation, InterviewMode, JobStatus, OfferStatus, RequisitionReason, RequisitionStatus } from '@contracts';

export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FILLED: 'Filled',
};
export const requisitionTone: Record<RequisitionStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  FILLED: 'info',
};
export const REASON_LABELS: Record<RequisitionReason, string> = { NEW_ROLE: 'New role', REPLACEMENT: 'Replacement', EXPANSION: 'Team expansion' };

export const JOB_STATUS_LABELS: Record<JobStatus, string> = { DRAFT: 'Draft', OPEN: 'Open', ON_HOLD: 'On hold', CLOSED: 'Closed' };
export const jobTone: Record<JobStatus, 'neutral' | 'success' | 'warning'> = { DRAFT: 'neutral', OPEN: 'success', ON_HOLD: 'warning', CLOSED: 'neutral' };

export const STAGE_LABELS: Record<ApplicationStage, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' };
export const stageTone: Record<ApplicationStage, 'neutral' | 'info' | 'violet' | 'brand' | 'success' | 'danger' | 'warning'> = {
  APPLIED: 'neutral',
  SCREENING: 'info',
  INTERVIEW: 'violet',
  OFFER: 'brand',
  HIRED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'warning',
};
export const stageAccent: Record<ApplicationStage, string> = {
  APPLIED: 'bg-slate-400',
  SCREENING: 'bg-sky-500',
  INTERVIEW: 'bg-violet-500',
  OFFER: 'bg-brand-500',
  HIRED: 'bg-emerald-500',
  REJECTED: 'bg-red-500',
  WITHDRAWN: 'bg-amber-500',
};

/** Stages in pipeline order, including the closed outcomes. */
export const PIPELINE_ORDER: ApplicationStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];

export const SOURCE_LABELS: Record<CandidateSource, string> = { CAREERS: 'Careers page', REFERRAL: 'Employee referral', JOB_BOARD: 'Job board', LINKEDIN: 'LinkedIn', AGENCY: 'Agency', DIRECT: 'Direct / sourced', OTHER: 'Other' };
export const MODE_LABELS: Record<InterviewMode, string> = { IN_PERSON: 'In person', VIDEO: 'Video call', PHONE: 'Phone' };
export const RECOMMENDATION_LABELS: Record<FeedbackRecommendation, string> = { STRONG_HIRE: 'Strong hire', HIRE: 'Hire', NO_HIRE: 'No hire', STRONG_NO_HIRE: 'Strong no hire' };
export const recommendationTone: Record<FeedbackRecommendation, 'success' | 'danger'> = { STRONG_HIRE: 'success', HIRE: 'success', NO_HIRE: 'danger', STRONG_NO_HIRE: 'danger' };
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = { DRAFT: 'Draft', RELEASED: 'Released – awaiting answer', ACCEPTED: 'Accepted', DECLINED: 'Declined', WITHDRAWN: 'Withdrawn' };
export const offerTone: Record<OfferStatus, 'neutral' | 'warning' | 'success' | 'danger'> = { DRAFT: 'neutral', RELEASED: 'warning', ACCEPTED: 'success', DECLINED: 'danger', WITHDRAWN: 'neutral' };

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
/** "₹12,00,000" in the organization currency (INR formatting). */
export function money(n: number | null | undefined, currency = 'INR'): string {
  if (n === null || n === undefined) return '—';
  return currency === 'INR' ? `₹${inr.format(n)}` : new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
export function experience(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${min}–${max} years`;
  return min !== null ? `${min}+ years` : `Up to ${max} years`;
}
