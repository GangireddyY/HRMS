import type { PermissionScope } from './permissions';

/**
 * Approvals a manager can hand over while away (approval delegation). Money and maker-checker approvals (payroll runs,
 * salary revisions, loans, bank changes) stay with the people who hold them.
 */
export const DELEGABLE_PERMISSIONS = ['leave.approve', 'attendance.regularize.approve', 'attendance.timesheet.approve', 'payroll.reimbursement.approve', 'travel.approve'] as const;
export type DelegablePermission = (typeof DELEGABLE_PERMISSIONS)[number];
export const DELEGABLE_LABELS: Record<DelegablePermission, string> = {
  'leave.approve': 'Leave and comp-off',
  'attendance.regularize.approve': 'Attendance corrections, work from home and overtime',
  'attendance.timesheet.approve': 'Timesheets',
  'payroll.reimbursement.approve': 'Expense claims',
  'travel.approve': 'Travel requests',
};

/** Longest single delegation. */
export const DELEGATION_MAX_DAYS = 90;

/** An approval right someone holds on behalf of another person, anchored on that person's team or department. */
export interface DelegatedGrant {
  permission: DelegablePermission;
  scope: PermissionScope;
  delegatorMembershipId: string;
  /** The delegator's employee record (TEAM / DEPARTMENT scope are relative to it); null = organization scope only. */
  delegatorEmployeeId: string | null;
  delegatorDepartmentId: string | null;
  delegatorName: string;
  endsOn: string;
}

/** Leave approval levels: 1 = manager (anyone who can approve in scope), 2 = HR (department- or organization-wide). */
export const APPROVAL_LEVEL_LABELS: Record<number, string> = { 1: 'Manager', 2: 'HR' };

// ---- Approval chains (configurable multi-level approval) ------------------------------------------------------

/** What a chain approves; each kind keeps its own module workflow and asks the chain who decides at each step. */
export const APPROVAL_SUBJECTS = ['LEAVE', 'EXPENSE', 'TRAVEL', 'EXIT', 'OFFER'] as const;
export type ApprovalSubject = (typeof APPROVAL_SUBJECTS)[number];
export const APPROVAL_SUBJECT_LABELS: Record<ApprovalSubject, string> = { LEAVE: 'Leave requests', EXPENSE: 'Expense claims', TRAVEL: 'Travel requests', EXIT: 'Resignations', OFFER: 'Job offers' };
/** The permission whose holders an escalation reaches (and that a delegate must have been handed over). */
export const APPROVAL_SUBJECT_PERMISSION: Record<ApprovalSubject, string> = {
  LEAVE: 'leave.approve',
  EXPENSE: 'payroll.reimbursement.approve',
  TRAVEL: 'travel.approve',
  EXIT: 'exit.approve',
  OFFER: 'recruitment.offer.approve',
};

/**
 * Who decides a step: the requester's manager, their manager's manager, people holding a permission department- or
 * organization-wide for the requester (e.g. HR, finance), or one named person.
 */
export const APPROVER_KINDS = ['MANAGER', 'SKIP_MANAGER', 'PERMISSION', 'USER'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

export interface ApprovalChainStep {
  label: string;
  approver: ApproverKind;
  /** PERMISSION: the permission (e.g. `payroll.reimbursement.finance`). */
  permission?: string;
  /** USER: the approver's membership. */
  membershipId?: string;
  /** Escalate to the next level up when undecided this long; null = no deadline. */
  slaHours?: number | null;
}

/** All set conditions must hold for the chain to apply (the first matching chain by priority wins). */
export interface ApprovalChainConditions {
  minDays?: number;
  minAmount?: number;
  departmentIds?: string[];
  leaveTypeIds?: string[];
  categories?: string[];
}

/** Facts about a request the chain conditions are checked against. */
export interface ApprovalFacts {
  days?: number;
  amount?: number;
  departmentId?: string | null;
  leaveTypeId?: string;
  category?: string;
}

export const APPROVAL_CHAIN_MAX_STEPS = 5;
export const APPROVAL_INSTANCE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type ApprovalInstanceStatus = (typeof APPROVAL_INSTANCE_STATUSES)[number];

export interface ApprovalStep {
  level: number;
  userId: string;
  name: string;
  at: string;
  note: string | null;
}
