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

export interface ApprovalStep {
  level: number;
  userId: string;
  name: string;
  at: string;
  note: string | null;
}
