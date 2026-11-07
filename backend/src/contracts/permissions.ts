/**
 * Permission catalog. This is the single source of truth for every permission key in the system.
 * The API synchronises this catalog into the `permissions` table on boot, and the web app uses it
 * to gate pages, menu items and actions.
 *
 * Levels:
 *  - Module: `module` (also the subscription feature key that entitles the module).
 *  - Page:   `page` (a screen / resource inside a module).
 *  - Action: the permission key itself (e.g. `employee.create`).
 *  - Record: `scopable` permissions carry a scope (OWN / TEAM / DEPARTMENT / ORGANIZATION) per role.
 */

export const PERMISSION_SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const SCOPE_RANK: Record<PermissionScope, number> = {
  OWN: 1,
  TEAM: 2,
  DEPARTMENT: 3,
  ORGANIZATION: 4,
};

export function maxScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

export function scopeCovers(granted: PermissionScope, required: PermissionScope): boolean {
  return SCOPE_RANK[granted] >= SCOPE_RANK[required];
}

export const MODULE_KEYS = [
  'core',
  'employee',
  'recruitment',
  'onboarding',
  'attendance',
  'leave',
  'payroll',
  'performance',
  'training',
  'engagement',
  'grievance',
  'benefits',
  'compliance',
  'exit',
  'reports',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  name: string;
  description: string;
  /** Core modules are always entitled regardless of subscription plan. */
  core: boolean;
}

export const MODULES: readonly ModuleDefinition[] = [
  { key: 'core', name: 'Core Platform', description: 'Organization settings, users, roles, audit and notifications.', core: true },
  { key: 'employee', name: 'Employee Management', description: 'Employee master data, lifecycle changes and history.', core: false },
  { key: 'recruitment', name: 'Recruitment', description: 'Requisitions, job openings, candidates, interviews and offers.', core: false },
  { key: 'onboarding', name: 'Onboarding', description: 'Joining formalities, documents, checklists and probation.', core: false },
  { key: 'attendance', name: 'Attendance', description: 'Shifts, punches, regularization and monthly closing.', core: false },
  { key: 'leave', name: 'Leave Management', description: 'Leave types, policies, balances and approvals.', core: false },
  { key: 'payroll', name: 'Payroll', description: 'Salary structures, statutory rules, payroll runs and payslips.', core: false },
  { key: 'performance', name: 'Performance', description: 'Cycles, goals, reviews, 360 feedback and PIPs.', core: false },
  { key: 'training', name: 'Training & Development', description: 'Courses, programs, assessments and certifications.', core: false },
  { key: 'engagement', name: 'Employee Engagement', description: 'Announcements, events, surveys and recognition.', core: false },
  { key: 'grievance', name: 'Grievance Management', description: 'Confidential cases, investigations and POSH handling.', core: false },
  { key: 'benefits', name: 'Benefits', description: 'Benefit plans, eligibility, enrollment and renewals.', core: false },
  { key: 'compliance', name: 'Compliance & Documents', description: 'Policies, statutory records and secure documents.', core: false },
  { key: 'exit', name: 'Exit Management', description: 'Resignations, clearances and full & final settlement.', core: false },
  { key: 'reports', name: 'Reports & Analytics', description: 'Dashboards, reports and exports.', core: false },
];

export interface PermissionDefinition {
  key: string;
  module: ModuleKey;
  page: string;
  description: string;
  /** Scopable permissions support record-level scope (OWN/TEAM/DEPARTMENT/ORGANIZATION). */
  scopable: boolean;
  /**
   * Restricted permissions are never granted implicitly (not even to Organization Admin)
   * and must be assigned explicitly, e.g. POSH Internal Committee access.
   */
  restricted?: boolean;
}

function def(
  module: ModuleKey,
  page: string,
  key: string,
  description: string,
  opts: { scopable?: boolean; restricted?: boolean } = {},
): PermissionDefinition {
  return { key, module, page, description, scopable: opts.scopable ?? false, restricted: opts.restricted ?? false };
}

const S = { scopable: true };

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // Core: organization
  def('core', 'organization.profile', 'organization.view', 'View organization profile and settings'),
  def('core', 'organization.profile', 'organization.update', 'Update organization profile and settings'),
  def('core', 'organization.security', 'organization.security.manage', 'Manage password, session and MFA policies'),
  def('core', 'organization.structure', 'organization.structure.manage', 'Manage branches, locations, departments, designations, grades and cost centers'),
  def('core', 'organization.calendar', 'organization.calendar.manage', 'Manage holidays and working-day calendars'),
  // Core: users & roles
  def('core', 'users', 'user.view', 'View organization users'),
  def('core', 'users', 'user.invite', 'Invite users to the organization'),
  def('core', 'users', 'user.update', 'Assign roles, suspend and reactivate users'),
  def('core', 'users', 'user.sessions.revoke', 'Revoke active sessions of users'),
  def('core', 'roles', 'role.view', 'View roles and permissions'),
  def('core', 'roles', 'role.manage', 'Create, edit and delete roles and their permissions'),
  // Core: audit
  def('core', 'audit', 'audit.view', 'View audit trail'),
  def('core', 'audit', 'audit.login_history.view', 'View login history of all users'),
  // Core: self-service
  def('core', 'self', 'self.profile.update', 'Update own permitted personal details'),

  // Employee
  def('employee', 'employees.directory', 'employee.view', 'View employee profiles', S),
  def('employee', 'employees.directory', 'employee.create', 'Create employees'),
  def('employee', 'employees.directory', 'employee.update', 'Update employee profiles', S),
  def('employee', 'employees.directory', 'employee.delete', 'Delete or archive employees'),
  def('employee', 'employees.directory', 'employee.import', 'Bulk import employees'),
  def('employee', 'employees.directory', 'employee.export', 'Export employee data'),
  def('employee', 'employees.lifecycle', 'employee.lifecycle.manage', 'Transfers, promotions, manager and status changes', S),
  def('employee', 'employees.compensation', 'employee.salary.view', 'View employee salary details', S),
  def('employee', 'employees.compensation', 'employee.salary.revise', 'Revise employee salary'),
  def('employee', 'employees.sensitive', 'employee.sensitive.view', 'View bank and statutory identifiers', S),
  def('employee', 'employees.documents', 'employee.document.manage', 'Manage employee documents', S),

  // Recruitment
  def('recruitment', 'recruitment.requisitions', 'recruitment.requisition.create', 'Raise manpower requisitions'),
  def('recruitment', 'recruitment.requisitions', 'recruitment.requisition.approve', 'Approve manpower requisitions', S),
  def('recruitment', 'recruitment.pipeline', 'recruitment.view', 'View jobs and candidates'),
  def('recruitment', 'recruitment.pipeline', 'recruitment.manage', 'Manage jobs, candidates and pipeline'),
  def('recruitment', 'recruitment.interviews', 'recruitment.interview.feedback', 'Submit interview feedback'),
  def('recruitment', 'recruitment.offers', 'recruitment.offer.manage', 'Generate and release offers'),

  // Onboarding
  def('onboarding', 'onboarding.cases', 'onboarding.view', 'View onboarding cases', S),
  def('onboarding', 'onboarding.cases', 'onboarding.manage', 'Manage onboarding cases and checklists'),
  def('onboarding', 'onboarding.documents', 'onboarding.document.verify', 'Verify joining documents'),
  def('onboarding', 'onboarding.probation', 'onboarding.confirmation.approve', 'Approve probation confirmations', S),

  // Attendance
  def('attendance', 'attendance.records', 'attendance.view', 'View attendance records', S),
  def('attendance', 'attendance.records', 'attendance.mark', 'Check in and check out'),
  def('attendance', 'attendance.records', 'attendance.manage', 'Edit attendance records', S),
  def('attendance', 'attendance.regularization', 'attendance.regularize.apply', 'Apply for attendance regularization'),
  def('attendance', 'attendance.regularization', 'attendance.regularize.approve', 'Approve attendance regularization, work from home and overtime', S),
  def('attendance', 'attendance.regularization', 'attendance.wfh.apply', 'Request to work from home'),
  def('attendance', 'attendance.configuration', 'attendance.configure', 'Configure shifts, rules and devices'),
  def('attendance', 'attendance.closing', 'attendance.close', 'Close monthly attendance'),

  // Leave
  def('leave', 'leave.requests', 'leave.view', 'View leave requests and balances', S),
  def('leave', 'leave.requests', 'leave.apply', 'Apply for leave'),
  def('leave', 'leave.requests', 'leave.approve', 'Approve leave requests', S),
  def('leave', 'leave.configuration', 'leave.configure', 'Configure leave types and policies'),
  def('leave', 'leave.allocation', 'leave.allocate', 'Allocate and adjust leave balances'),

  // Payroll
  def('payroll', 'payroll.runs', 'payroll.view', 'View payroll runs and results'),
  def('payroll', 'payroll.runs', 'payroll.process', 'Create and calculate payroll runs'),
  def('payroll', 'payroll.runs', 'payroll.validate', 'Validate payroll runs'),
  def('payroll', 'payroll.runs', 'payroll.review', 'Review payroll runs'),
  def('payroll', 'payroll.runs', 'payroll.approve', 'Approve payroll runs'),
  def('payroll', 'payroll.runs', 'payroll.disburse', 'Mark payroll paid, export bank files and close runs'),
  def('payroll', 'payroll.configuration', 'payroll.configure', 'Configure salary structures and statutory rules'),
  def('payroll', 'payroll.payslips', 'payroll.payslip.view', 'View payslips', S),
  def('payroll', 'payroll.reimbursements', 'payroll.reimbursement.apply', 'Submit reimbursement claims'),
  def('payroll', 'payroll.reimbursements', 'payroll.reimbursement.approve', 'Approve reimbursement claims', S),
  def('payroll', 'payroll.settlements', 'payroll.settlement.manage', 'Manage full and final settlements'),
  def('payroll', 'payroll.loans', 'payroll.loan.apply', 'Request loans and salary advances'),
  def('payroll', 'payroll.loans', 'payroll.loan.approve', 'Approve loan and salary advance requests and set their terms'),
  def('payroll', 'payroll.loans', 'payroll.loan.manage', 'Raise, disburse and track loans and advances and record repayments'),

  // Performance
  def('performance', 'performance.reviews', 'performance.view', 'View performance reviews and goals', S),
  def('performance', 'performance.configuration', 'performance.configure', 'Configure cycles, forms and rating scales'),
  def('performance', 'performance.reviews', 'performance.review', 'Conduct manager reviews', S),
  def('performance', 'performance.reviews', 'performance.self_assess', 'Submit self-assessment and goals'),
  def('performance', 'performance.feedback', 'performance.feedback.give', 'Give peer / 360 feedback'),
  def('performance', 'performance.pip', 'performance.pip.manage', 'Manage performance improvement plans', S),

  // Training
  def('training', 'training.catalog', 'training.view', 'View courses and programs'),
  def('training', 'training.catalog', 'training.manage', 'Manage courses, programs and assessments'),
  def('training', 'training.enrollment', 'training.enroll', 'Enroll in training'),
  def('training', 'training.enrollment', 'training.assign', 'Assign training to employees', S),

  // Engagement
  def('engagement', 'engagement.feed', 'engagement.view', 'View announcements, events and recognitions'),
  def('engagement', 'engagement.feed', 'engagement.announcement.manage', 'Publish announcements and events'),
  def('engagement', 'engagement.surveys', 'engagement.survey.manage', 'Create and analyse surveys'),
  def('engagement', 'engagement.surveys', 'engagement.survey.respond', 'Respond to surveys'),
  def('engagement', 'engagement.recognition', 'engagement.recognition.give', 'Give recognition and suggestions'),

  // Grievance
  def('grievance', 'grievance.cases', 'grievance.submit', 'Submit grievances'),
  def('grievance', 'grievance.cases', 'grievance.view', 'View assigned grievance cases'),
  def('grievance', 'grievance.cases', 'grievance.manage', 'Assign, investigate and resolve grievance cases'),
  def('grievance', 'grievance.posh', 'grievance.posh.access', 'Access POSH cases (Internal Committee only)', { restricted: true }),

  // Benefits
  def('benefits', 'benefits.enrollment', 'benefits.view', 'View benefit enrollments', S),
  def('benefits', 'benefits.configuration', 'benefits.manage', 'Manage benefit plans and eligibility'),
  def('benefits', 'benefits.enrollment', 'benefits.enroll', 'Enroll in benefits'),

  // Compliance
  def('compliance', 'compliance.documents', 'compliance.view', 'View the policies that apply to you'),
  def('compliance', 'compliance.documents', 'compliance.manage', 'Manage policies, acknowledgements and the statutory calendar'),
  def('compliance', 'compliance.documents', 'compliance.policy.acknowledge', 'Acknowledge policies'),

  // Exit
  def('exit', 'exit.cases', 'exit.view', 'View exit cases', S),
  def('exit', 'exit.cases', 'exit.resign', 'Submit resignation'),
  def('exit', 'exit.cases', 'exit.approve', 'Approve resignations', S),
  def('exit', 'exit.cases', 'exit.manage', 'Manage exit process and letters'),
  def('exit', 'exit.clearance', 'exit.clearance.manage', 'Process exit clearances'),

  // Reports
  def('reports', 'reports.hr', 'reports.view', 'View HR reports and dashboards', S),
  def('reports', 'reports.payroll', 'reports.payroll.view', 'View payroll and cost reports'),
  def('reports', 'reports.recruitment', 'reports.recruitment.view', 'View recruitment reports'),
  def('reports', 'reports.export', 'reports.export', 'Export reports (CSV / Excel / PDF)'),
];

export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function getPermission(key: string): PermissionDefinition | undefined {
  return byKey.get(key);
}

export function isKnownPermission(key: string): boolean {
  return byKey.has(key);
}

/** Platform-level (Super Admin) capabilities. Not tenant-scoped and not assignable to org roles. */
export const PLATFORM_PERMISSIONS = [
  'platform.organizations.view',
  'platform.organizations.manage',
  'platform.plans.manage',
  'platform.audit.view',
] as const;
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
