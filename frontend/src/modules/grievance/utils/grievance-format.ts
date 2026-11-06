import type { GrievanceCategory, GrievanceOutcome, GrievancePriority, GrievanceStatus } from '@contracts';

export const CATEGORY_LABELS: Record<GrievanceCategory, string> = {
  WORKPLACE: 'Workplace & working conditions',
  MANAGER: 'Manager or team',
  PAY_BENEFITS: 'Pay & benefits',
  DISCRIMINATION: 'Discrimination',
  HARASSMENT: 'Bullying or harassment (non-sexual)',
  SAFETY: 'Health & safety',
  POLICY: 'Policy or process',
  OTHER: 'Other',
  POSH: 'Sexual harassment (POSH)',
};

export const STATUS_LABELS: Record<GrievanceStatus, string> = { SUBMITTED: 'Submitted', IN_REVIEW: 'In review', INVESTIGATING: 'Investigating', RESOLVED: 'Resolved', CLOSED: 'Closed', WITHDRAWN: 'Withdrawn' };
export const statusTone: Record<GrievanceStatus, 'neutral' | 'info' | 'warning' | 'success' | 'brand'> = {
  SUBMITTED: 'warning',
  IN_REVIEW: 'info',
  INVESTIGATING: 'info',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  WITHDRAWN: 'neutral',
};

export const PRIORITY_LABELS: Record<GrievancePriority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
export const priorityTone: Record<GrievancePriority, 'neutral' | 'info' | 'warning' | 'danger'> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };

export const OUTCOME_LABELS: Record<GrievanceOutcome, string> = { UPHELD: 'Upheld', PARTIALLY_UPHELD: 'Partially upheld', NOT_UPHELD: 'Not upheld', SETTLED: 'Settled' };
export const OUTCOME_HELP: Record<GrievanceOutcome, string> = {
  UPHELD: 'The complaint was found to be true',
  PARTIALLY_UPHELD: 'Some of the complaint was found to be true',
  NOT_UPHELD: 'The complaint could not be substantiated',
  SETTLED: 'Resolved informally (for POSH: conciliation at the complainant’s request)',
};

export const EVENT_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  ASSIGNED: 'Assignment',
  INVESTIGATING: 'Investigation started',
  PRIORITY: 'Priority',
  RESOLVED: 'Resolved',
  REOPENED: 'Reopened',
  ACCEPTED: 'Resolution accepted',
  CLOSED: 'Closed',
  WITHDRAWN: 'Withdrawn',
};

/** The complainant's progress steps. */
export const STEPS: { status: GrievanceStatus; label: string }[] = [
  { status: 'SUBMITTED', label: 'Submitted' },
  { status: 'IN_REVIEW', label: 'In review' },
  { status: 'INVESTIGATING', label: 'Investigating' },
  { status: 'RESOLVED', label: 'Resolved' },
  { status: 'CLOSED', label: 'Closed' },
];

export const fileSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
