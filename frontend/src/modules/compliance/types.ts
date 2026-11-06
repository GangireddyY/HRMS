import type { ComplianceCategory, EmploymentType, FilingState, PolicyCategory, PolicyStatus, PolicyVersionStatus } from '@contracts';

export type AckState = 'ACKNOWLEDGED' | 'PENDING' | 'OVERDUE';

export interface AckCounts {
  audience: number;
  acknowledged: number;
  pending: number;
  overdue: number;
}

export interface PolicySummary {
  id: string;
  title: string;
  category: PolicyCategory;
  summary: string | null;
  status: PolicyStatus;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  employmentTypes: EmploymentType[] | null;
  requiresAck: boolean;
  ackDueDays: number;
  reviewMonths: number | null;
  nextReviewOn: string | null;
  reviewDue: boolean;
  currentVersion: { id: string; version: number; publishedOn: string | null; effectiveFrom: string | null } | null;
  hasDraft: boolean;
  lastRemindedAt: string | null;
  updatedAt: string;
  stats: AckCounts | null;
}

export interface PolicyVersion {
  id: string;
  version: number;
  status: PolicyVersionStatus;
  content: string | null;
  file: { name: string; size: number } | null;
  changeSummary: string | null;
  reacknowledge: boolean;
  effectiveFrom: string | null;
  publishedOn: string | null;
  publishedBy: string | null;
}

export interface PolicyDetail extends PolicySummary {
  owner: { id: string; name: string } | null;
  versions: PolicyVersion[];
}

export interface PersonAck {
  employee: { id: string; name: string; employeeCode: string; department: string | null };
  state: AckState;
  dueOn: string;
  acknowledgedAt: string | null;
  acknowledgedVersion: number | null;
}

export interface MyPolicy {
  id: string;
  title: string;
  category: PolicyCategory;
  summary: string | null;
  requiresAck: boolean;
  version: { id: string; version: number; effectiveFrom: string | null; publishedOn: string | null; changeSummary: string | null };
  state: AckState | null;
  dueOn: string | null;
  acknowledgedAt: string | null;
  acknowledgedVersion: number | null;
}

export interface PolicyReading {
  id: string;
  title: string;
  category: PolicyCategory;
  summary: string | null;
  requiresAck: boolean;
  version: PolicyVersion;
  mine: PersonAck | null;
  canAcknowledge: boolean;
}

export interface PolicyInput {
  title: string;
  category: PolicyCategory;
  summary: string | null;
  ownerUserId: string | null;
  departmentIds: string[] | null;
  locationIds: string[] | null;
  employmentTypes: EmploymentType[] | null;
  requiresAck: boolean;
  ackDueDays: number;
  reviewMonths: number | null;
  content?: string | null;
}

export interface Obligation {
  id: string;
  title: string;
  category: ComplianceCategory;
  authority: string | null;
  description: string | null;
  dueDates: string[];
  startsOn: string;
  endsOn: string | null;
  owner: { id: string; name: string } | null;
  active: boolean;
  filings?: number;
}

export interface ObligationInput {
  title: string;
  category: ComplianceCategory;
  authority: string | null;
  description: string | null;
  dueDates: string[];
  startsOn: string;
  endsOn: string | null;
  ownerUserId: string | null;
  active: boolean;
}

export interface CalendarItem {
  obligation: Obligation;
  dueOn: string;
  state: FilingState;
  filing: { id: string; completedOn: string; late: boolean; reference: string | null; note: string | null; file: { name: string; type: string; size: number } | null; completedBy: string | null; createdAt: string } | null;
}

export interface Calendar {
  today: string;
  items: CalendarItem[];
  counts: { overdue: number; dueSoon: number; done: number };
}
