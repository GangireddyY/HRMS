import type { GrievanceCategory, GrievanceOutcome, GrievancePriority, GrievanceStatus, GrievanceVisibility } from '@contracts';
import type { Colleague } from '@/modules/performance/types';

export type GrievanceView = 'assigned' | 'all' | 'posh';

export interface CaseSummary {
  id: string;
  reference: string;
  category: GrievanceCategory;
  posh: boolean;
  subject: string;
  status: GrievanceStatus;
  /** Only for the people handling the case. */
  priority?: GrievancePriority;
  assignee: { id: string; name: string } | null;
  submittedOn: string;
  dueOn: string;
  overdue: boolean;
  resolvedOn: string | null;
  outcome: GrievanceOutcome | null;
  updatedAt: string;
}

export interface CaseRow extends CaseSummary {
  complainant: Colleague | null;
  respondent: { id: string; name: string; employeeCode: string } | null;
  respondentName: string | null;
}

export interface CaseNote {
  id: string;
  author: string;
  fromComplainant: boolean;
  visibility: GrievanceVisibility;
  body: string;
  createdAt: string;
}

export interface CaseFile {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  visibility: GrievanceVisibility;
  fromComplainant: boolean;
  uploadedBy: string;
  createdAt: string;
}

export interface CaseEvent {
  id: string;
  type: string;
  fromStatus: GrievanceStatus | null;
  toStatus: GrievanceStatus | null;
  detail: string | null;
  internal: boolean;
  actor: string | null;
  createdAt: string;
}

export interface ComplainantPermissions {
  note: boolean;
  attach: boolean;
  withdraw: boolean;
  accept: boolean;
  reopen: boolean;
  reopenBlocker: string | null;
}

export interface HandlerPermissions {
  manage: boolean;
  note: boolean;
  attach: boolean;
  assign: boolean;
  priority: boolean;
  acknowledge: boolean;
  investigate: boolean;
  resolve: boolean;
  close: boolean;
  closeBlocker: string | null;
}

interface CaseDetailBase extends CaseSummary {
  complainant: Colleague | null;
  respondent: Colleague | null;
  respondentName: string | null;
  incidentDate: string | null;
  incidentLocation: string | null;
  description: string;
  witnesses: string | null;
  poshDetails: { delayReason: string | null; interimRelief: string | null; conciliationRequested: boolean; filing: 'ON_TIME' | 'LATE' | 'BEYOND_EXTENSION' } | null;
  resolution: { summary: string; actions?: string | null; resolvedBy: string | null; resolvedAt: string } | null;
  reopened: boolean;
  reopenUntil: string | null;
  acknowledgedAt: string | null;
  acceptedAt: string | null;
  closedAt: string | null;
  withdrawnAt: string | null;
  notes: CaseNote[];
  attachments: CaseFile[];
  events: CaseEvent[];
}

export type CaseDetail = (CaseDetailBase & { role: 'COMPLAINANT'; permissions: ComplainantPermissions }) | (CaseDetailBase & { role: 'HANDLER'; permissions: HandlerPermissions });

export interface GrievanceInput {
  category: GrievanceCategory;
  subject: string;
  description: string;
  respondentId?: string | null;
  respondentName?: string | null;
  incidentDate?: string | null;
  incidentLocation?: string | null;
  witnesses?: string | null;
  delayReason?: string | null;
  interimRelief?: string | null;
  conciliationRequested?: boolean;
}

export interface ViewStats {
  open: number;
  overdue: number;
  unassigned?: number;
}

export interface Handler {
  id: string;
  name: string;
  email: string;
}

export interface PoshReport {
  year: number;
  asOf: string;
  received: number;
  disposed: number;
  withdrawn: number;
  pending: number;
  pendingOver90Days: number;
  outcomes: Partial<Record<GrievanceOutcome, number>>;
}
