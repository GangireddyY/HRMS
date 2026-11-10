import type { CycleStatus, HikeStatus, OkrHealth, OkrLevel, OkrMetric, OkrStatus, OneOnOneStatus, PipProgress, PipStatus, ReviewStage } from '@contracts';

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

export const OKR_LEVEL_LABELS: Record<OkrLevel, string> = { COMPANY: 'Company', DEPARTMENT: 'Department', INDIVIDUAL: 'Individual' };
export const okrLevelTone: Record<OkrLevel, 'brand' | 'violet' | 'info'> = { COMPANY: 'brand', DEPARTMENT: 'violet', INDIVIDUAL: 'info' };
export const OKR_HEALTH_LABELS: Record<OkrHealth, string> = { ON_TRACK: 'On track', AT_RISK: 'At risk', OFF_TRACK: 'Off track' };
export const okrHealthTone: Record<OkrHealth, 'success' | 'warning' | 'danger'> = { ON_TRACK: 'success', AT_RISK: 'warning', OFF_TRACK: 'danger' };
export const OKR_HEALTH_FILL: Record<OkrHealth, string> = { ON_TRACK: 'bg-success', AT_RISK: 'bg-warning', OFF_TRACK: 'bg-danger' };
export const OKR_STATUS_LABELS: Record<OkrStatus, string> = { ACTIVE: 'Active', CLOSED: 'Closed', DROPPED: 'Dropped' };
export const OKR_METRIC_LABELS: Record<OkrMetric, string> = { NUMBER: 'Number', PERCENT: 'Percentage', CURRENCY: 'Amount', MILESTONE: 'Milestone (done / not done)' };

export const ONE_ON_ONE_STATUS_LABELS: Record<OneOnOneStatus, string> = { SCHEDULED: 'Scheduled', DONE: 'Held', CANCELLED: 'Cancelled' };
export const oneOnOneTone: Record<OneOnOneStatus, 'info' | 'success' | 'neutral'> = { SCHEDULED: 'info', DONE: 'success', CANCELLED: 'neutral' };

/** 9-box cell colour by [performance band][potential band]. */
export const NINE_BOX_TONE: readonly (readonly string[])[] = [
  ['bg-danger-soft text-danger-fg', 'bg-warning-soft text-warning-fg', 'bg-info-soft text-info-fg'],
  ['bg-warning-soft text-warning-fg', 'bg-info-soft text-info-fg', 'bg-accent-soft text-accent-fg'],
  ['bg-info-soft text-info-fg', 'bg-accent-soft text-accent-fg', 'bg-success-soft text-success-fg'],
];

/** A key result value with its unit ("42 deals", "65%", "Rs 1,20,000"). */
export function krValue(value: number, kr: { metric: OkrMetric; unit: string | null }, money: (n: number) => string): string {
  if (kr.metric === 'MILESTONE') return value >= 1 ? 'Done' : 'Not yet';
  if (kr.metric === 'CURRENCY') return money(value);
  const n = String(Number(value.toFixed(2)));
  if (kr.metric === 'PERCENT') return `${n}%`;
  return kr.unit ? `${n} ${kr.unit}` : n;
}

/** Where a key result stands: "26 of 40 customers", "260 ms · target 200 ms" (lower is better), "Done". */
export function krProgressText(kr: { metric: OkrMetric; unit: string | null; startValue: number; targetValue: number; currentValue: number }, money: (n: number) => string): string {
  if (kr.metric === 'MILESTONE') return `Milestone · ${krValue(kr.currentValue, kr, money)}`;
  if (kr.targetValue < kr.startValue) return `${krValue(kr.currentValue, kr, money)} · target ${krValue(kr.targetValue, kr, money)}`;
  const bare = kr.metric === 'NUMBER' ? krValue(kr.currentValue, { ...kr, unit: null }, money) : krValue(kr.currentValue, kr, money);
  return `${bare} of ${krValue(kr.targetValue, kr, money)}`;
}

/** "3 · Meets expectations" using the cycle's labels. */
export const ratingText = (rating: number | null | undefined, labels: string[]) => (rating ? `${rating} · ${labels[rating - 1] ?? ''}` : '—');
