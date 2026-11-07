import type { CycleStatus, HikeStatus, PipProgress, PipStatus, ReviewStage } from '@contracts';

export const CYCLE_STATUS_LABELS: Record<CycleStatus, string> = { DRAFT: 'Draft', ACTIVE: 'In progress', CLOSED: 'Closed' };
export const cycleTone: Record<CycleStatus, 'neutral' | 'info' | 'success'> = { DRAFT: 'neutral', ACTIVE: 'info', CLOSED: 'success' };

export const STAGE_LABELS: Record<ReviewStage, string> = {
  GOAL_SETTING: 'Setting goals',
  GOAL_APPROVAL: 'Goals awaiting approval',
  SELF_REVIEW: 'Self-review',
  MANAGER_REVIEW: 'Manager review',
  COMPLETED: 'Completed',
  ACKNOWLEDGED: 'Acknowledged',
};
export const stageTone: Record<ReviewStage, 'neutral' | 'warning' | 'info' | 'violet' | 'brand' | 'success'> = {
  GOAL_SETTING: 'neutral',
  GOAL_APPROVAL: 'warning',
  SELF_REVIEW: 'info',
  MANAGER_REVIEW: 'violet',
  COMPLETED: 'brand',
  ACKNOWLEDGED: 'success',
};
export const STAGE_ORDER: ReviewStage[] = ['GOAL_SETTING', 'GOAL_APPROVAL', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETED', 'ACKNOWLEDGED'];

export const PIP_STATUS_LABELS: Record<PipStatus, string> = { ACTIVE: 'Active', SUCCESSFUL: 'Completed successfully', UNSUCCESSFUL: 'Not met', CANCELLED: 'Cancelled' };
export const pipTone: Record<PipStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { ACTIVE: 'warning', SUCCESSFUL: 'success', UNSUCCESSFUL: 'danger', CANCELLED: 'neutral' };
export const PIP_PROGRESS_LABELS: Record<PipProgress, string> = { ON_TRACK: 'On track', SOME_PROGRESS: 'Some progress', OFF_TRACK: 'Off track' };
export const pipProgressTone: Record<PipProgress, 'success' | 'warning' | 'danger'> = { ON_TRACK: 'success', SOME_PROGRESS: 'warning', OFF_TRACK: 'danger' };

export const HIKE_STATUS_LABELS: Record<HikeStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'Awaiting approval', APPROVED: 'Approved', REJECTED: 'Not approved', APPLIED: 'Applied' };
export const hikeTone: Record<HikeStatus, 'neutral' | 'warning' | 'success' | 'danger' | 'brand'> = { DRAFT: 'neutral', SUBMITTED: 'warning', APPROVED: 'success', REJECTED: 'danger', APPLIED: 'brand' };

/** "3 · Meets expectations" using the cycle's labels. */
export const ratingText = (rating: number | null | undefined, labels: string[]) => (rating ? `${rating} · ${labels[rating - 1] ?? ''}` : '—');
