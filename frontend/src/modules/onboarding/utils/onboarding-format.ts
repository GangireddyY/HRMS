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
export const PHASES = ['before', 'first-day', 'first-week', 'later'] as const;
export type Phase = (typeof PHASES)[number];

interface TaskLike {
  assignee: OnboardingAssignee;
  documentCategory: string | null;
  state: OnboardingTaskState;
}
interface CaseLike {
  status: OnboardingCaseStatus;
  permissions: { manage: boolean; verify: boolean; isSelf: boolean; isManager: boolean };
}
export const isFinished = (t: { state: OnboardingTaskState }) => t.state === 'DONE' || t.state === 'SKIPPED';
/** Whether the viewer is the one to act next on this task (complete it, or upload its document). */
export function needsViewer(c: CaseLike, t: TaskLike): boolean {
  if (c.status !== 'IN_PROGRESS' || isFinished(t) || t.state === 'SUBMITTED') return false;
  const p = c.permissions;
  if (t.documentCategory) return p.isSelf || (p.manage && !p.isSelf && t.assignee !== 'EMPLOYEE');
  return (t.assignee === 'EMPLOYEE' && p.isSelf) || (t.assignee === 'MANAGER' && p.isManager) || (t.assignee === 'HR' && p.manage);
}

/** Whole days from today to an ISO date (negative when it's in the past). */
export function daysFromToday(iso: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((new Date(`${iso}T00:00:00Z`).getTime() - today) / 86_400_000);
}
/** "Joins in 3 days", "Joins today", "Day 12" (day 1 is the joining day). */
export function joinRelative(iso: string): string {
  const d = daysFromToday(iso);
  if (d > 1) return `Joins in ${d} days`;
  if (d === 1) return 'Joins tomorrow';
  if (d === 0) return 'Joins today';
  return `Day ${-d + 1}`;
}

/** Where an onboarding case is in the joiner's journey, for pipeline views. */
export type CaseStage = 'preboarding' | 'first-week' | 'settling' | 'ready' | 'completed' | 'cancelled';
export const STAGE_LABELS: Record<CaseStage, string> = {
  preboarding: 'Pre-boarding',
  'first-week': 'First week',
  settling: 'Settling in',
  ready: 'Ready to complete',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const stageTone: Record<CaseStage, 'info' | 'brand' | 'violet' | 'success' | 'neutral'> = {
  preboarding: 'info',
  'first-week': 'brand',
  settling: 'violet',
  ready: 'success',
  completed: 'success',
  cancelled: 'neutral',
};
export function caseStage(c: { status: OnboardingCaseStatus; joiningDate: string; progress: { requiredOpen: number } }): CaseStage {
  if (c.status === 'COMPLETED') return 'completed';
  if (c.status === 'CANCELLED') return 'cancelled';
  if (!c.progress.requiredOpen) return 'ready';
  const d = daysFromToday(c.joiningDate);
  return d > 0 ? 'preboarding' : d >= -6 ? 'first-week' : 'settling';
}

/** Probation countdown from `daysLeft`: "3 days overdue", "Ends today", "in 12 days". */
export const probationCountdown = (days: number) => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `in ${days} days`);
export const probationCountdownTone = (days: number) =>
  days < 0 ? 'bg-danger-soft text-danger-fg ring-danger/20' : days <= 14 ? 'bg-warning-soft text-warning-fg ring-warning/25' : 'bg-surface-muted text-fg-muted ring-line';
/** "4 months in" from the joining date. */
export function tenure(iso: string): string {
  const months = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / (30.44 * 86_400_000)));
  return months < 1 ? 'Less than a month in' : `${months} month${months === 1 ? '' : 's'} in`;
}

/** "Due today", "Due in 3 days", "2 days overdue". */
export function dueLabel(iso: string, overdue: boolean): string {
  const d = daysFromToday(iso);
  if (overdue || d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}
