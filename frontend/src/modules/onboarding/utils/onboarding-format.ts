import type { OnboardingAssignee, OnboardingCaseStatus, OnboardingTaskState, ProbationRecommendation, ProbationReviewStatus } from '@contracts';

export const ASSIGNEE_LABELS: Record<OnboardingAssignee, string> = { EMPLOYEE: 'New joiner', MANAGER: 'Manager', HR: 'HR' };
export const assigneeTone: Record<OnboardingAssignee, 'brand' | 'violet' | 'info'> = { EMPLOYEE: 'brand', MANAGER: 'violet', HR: 'info' };

export const CASE_STATUS_LABELS: Record<OnboardingCaseStatus, string> = { IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const caseStatusTone: Record<OnboardingCaseStatus, 'info' | 'success' | 'neutral'> = { IN_PROGRESS: 'info', COMPLETED: 'success', CANCELLED: 'neutral' };

export const TASK_STATE_LABELS: Record<OnboardingTaskState, string> = {
  PENDING: 'To do',
  SUBMITTED: 'Awaiting verification',
  REJECTED: 'Rejected – upload again',
  DONE: 'Done',
  SKIPPED: 'Skipped',
};
export const taskStateTone: Record<OnboardingTaskState, 'neutral' | 'warning' | 'danger' | 'success'> = { PENDING: 'neutral', SUBMITTED: 'warning', REJECTED: 'danger', DONE: 'success', SKIPPED: 'neutral' };

export const RECOMMENDATION_LABELS: Record<ProbationRecommendation, string> = { CONFIRM: 'Confirm', EXTEND: 'Extend probation' };
export const REVIEW_STATUS_LABELS: Record<ProbationReviewStatus, string> = { PENDING: 'Awaiting decision', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Withdrawn' };
export const reviewStatusTone: Record<ProbationReviewStatus, 'warning' | 'success' | 'danger' | 'neutral'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };

/** "3 days before joining", "on the joining day", "10 days after joining". */
export function offsetLabel(days: number): string {
  if (days === 0) return 'On the joining day';
  const n = Math.abs(days);
  return `${n} day${n === 1 ? '' : 's'} ${days < 0 ? 'before' : 'after'} joining`;
}

/** Timeline group of a task relative to the joining date. */
export function phaseOf(dueDate: string, joiningDate: string): 'before' | 'first-day' | 'first-week' | 'later' {
  const diff = Math.round((new Date(`${dueDate}T00:00:00Z`).getTime() - new Date(`${joiningDate}T00:00:00Z`).getTime()) / 86_400_000);
  return diff < 0 ? 'before' : diff === 0 ? 'first-day' : diff <= 7 ? 'first-week' : 'later';
}
export const PHASE_LABELS = { before: 'Before joining', 'first-day': 'Joining day', 'first-week': 'First week', later: 'Later' } as const;
