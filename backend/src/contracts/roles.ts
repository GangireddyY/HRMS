import { PERMISSIONS, getPermission, maxScope } from './permissions';
import type { PermissionScope } from './permissions';

export interface RoleGrant {
  key: string;
  scope: PermissionScope;
}

export interface SystemRoleTemplate {
  key: string;
  name: string;
  description: string;
  /** Locked roles cannot have their permissions edited (prevents admins locking themselves out). */
  locked: boolean;
  grants: readonly RoleGrant[];
}

/**
 * Super Admin is a platform role stored on the user (`users.platform_role`), not an organization role.
 * Every other role below is provisioned into each organization on creation and can then be customised
 * (except locked roles). Organizations may also create their own custom roles.
 */
export const SUPER_ADMIN_ROLE = {
  key: 'super_admin',
  name: 'Super Admin',
  description: 'Platform operator. Manages organizations, plans and entitlements across tenants.',
} as const;

const ORG = 'ORGANIZATION' as const;

/** Expands keys into grants. Scopable permissions receive the given scope; others are organization-wide. */
function grants(scope: PermissionScope, ...keys: string[]): RoleGrant[] {
  return keys.map((key) => {
    const p = getPermission(key);
    if (!p) throw new Error(`Unknown permission in role template: ${key}`);
    return { key, scope: p.scopable ? scope : ORG };
  });
}

function moduleGrants(scope: PermissionScope, ...modules: string[]): RoleGrant[] {
  return grants(
    scope,
    ...PERMISSIONS.filter((p) => modules.includes(p.module) && !p.restricted).map((p) => p.key),
  );
}

/** Unions grant lists; when a key appears more than once the broadest scope wins. */
function merge(...lists: RoleGrant[][]): RoleGrant[] {
  const out = new Map<string, RoleGrant>();
  for (const list of lists) {
    for (const g of list) {
      const existing = out.get(g.key);
      out.set(g.key, existing ? { key: g.key, scope: maxScope(existing.scope, g.scope) } : g);
    }
  }
  return [...out.values()];
}

const EMPLOYEE_SELF_SERVICE = merge(
  grants('OWN',
    'self.profile.update',
    'employee.view',
    'attendance.view', 'attendance.mark', 'attendance.regularize.apply', 'attendance.wfh.apply', 'attendance.timesheet.submit',
    'leave.view', 'leave.apply',
    'payroll.payslip.view', 'payroll.reimbursement.apply', 'payroll.loan.apply',
    'performance.view', 'performance.self_assess', 'performance.feedback.give',
    'training.view', 'training.enroll',
    'engagement.view', 'engagement.survey.respond', 'engagement.recognition.give',
    'grievance.submit',
    'benefits.view', 'benefits.enroll',
    'compliance.view', 'compliance.policy.acknowledge',
    'exit.view', 'exit.resign',
    'assets.request', 'helpdesk.raise', 'travel.request',
  ),
);

const AUDITOR_EXCLUDED = new Set(['employee.sensitive.view', 'grievance.view']);

const READ_ONLY_KEYS = PERMISSIONS.filter(
  (p) => !p.restricted && !AUDITOR_EXCLUDED.has(p.key) && /\.view$/.test(p.key),
).map((p) => p.key);

export const SYSTEM_ROLE_TEMPLATES: readonly SystemRoleTemplate[] = [
  {
    key: 'org_admin',
    name: 'Organization Admin',
    description: 'Full administrative access to the organization (excluding restricted POSH access).',
    locked: true,
    grants: grants(ORG, ...PERMISSIONS.filter((p) => !p.restricted).map((p) => p.key)),
  },
  {
    key: 'hr_director',
    name: 'HR Director',
    description: 'Leads HR. Full HR operations plus payroll oversight and approvals.',
    locked: false,
    grants: merge(
      moduleGrants(ORG, 'employee', 'recruitment', 'onboarding', 'attendance', 'leave', 'performance',
        'training', 'engagement', 'grievance', 'benefits', 'compliance', 'exit', 'reports', 'assets', 'helpdesk', 'travel'),
      grants(ORG, 'organization.view', 'organization.structure.manage', 'organization.calendar.manage',
        'user.view', 'user.invite', 'role.view', 'audit.view',
        'payroll.view', 'payroll.review', 'payroll.approve', 'payroll.payslip.view', 'payroll.settlement.manage', 'payroll.loan.approve'),
      EMPLOYEE_SELF_SERVICE,
    ),
  },
  {
    key: 'hr_manager',
    name: 'HR Manager',
    description: 'Manages day-to-day HR operations across the organization.',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      moduleGrants(ORG, 'employee', 'recruitment', 'onboarding', 'attendance', 'leave', 'performance',
        'training', 'engagement', 'benefits', 'compliance', 'exit', 'assets', 'helpdesk', 'travel'),
      grants(ORG, 'organization.view', 'organization.structure.manage', 'organization.calendar.manage',
        'user.view', 'role.view', 'grievance.view', 'grievance.manage', 'payroll.view',
        'reports.view', 'reports.recruitment.view', 'reports.export'),
    ),
  },
  {
    key: 'hr_executive',
    name: 'HR Executive',
    description: 'Executes HR transactions: employee records, onboarding, attendance and leave administration.',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      grants(ORG, 'organization.view',
        'employee.view', 'employee.create', 'employee.update', 'employee.import', 'employee.export', 'employee.document.manage',
        'onboarding.view', 'onboarding.manage', 'onboarding.document.verify',
        'attendance.view', 'attendance.manage', 'attendance.timesheet.approve', 'leave.view', 'leave.allocate',
        'training.view', 'training.assign', 'compliance.view', 'exit.view', 'exit.clearance.manage',
        'engagement.announcement.manage', 'reports.view'),
    ),
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Runs hiring pipelines from requisition to offer. Cannot approve requisitions or offers (segregation of duties).',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      moduleGrants(ORG, 'recruitment').filter((g) => g.key !== 'recruitment.requisition.approve' && g.key !== 'recruitment.offer.approve'),
      grants(ORG, 'onboarding.view', 'reports.recruitment.view'),
    ),
  },
  {
    key: 'payroll_manager',
    name: 'Payroll Manager',
    description: 'Configures and processes payroll. Cannot approve own runs (segregation of duties).',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      grants(ORG, 'employee.view', 'employee.salary.view', 'employee.salary.revise', 'employee.sensitive.view',
        'attendance.view', 'leave.view',
        'payroll.view', 'payroll.process', 'payroll.validate', 'payroll.configure', 'payroll.payslip.view',
        'payroll.reimbursement.approve', 'payroll.settlement.manage', 'payroll.loan.manage', 'exit.view',
        'reports.payroll.view', 'reports.export'),
    ),
  },
  {
    key: 'finance_manager',
    name: 'Finance Manager',
    description: 'Reviews and approves payroll and disbursements; owns cost reporting.',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      grants(ORG, 'employee.salary.view', 'employee.salary.approve', 'payroll.view', 'payroll.review', 'payroll.approve', 'payroll.disburse',
        'payroll.reimbursement.approve', 'payroll.reimbursement.finance', 'payroll.settlement.manage', 'payroll.loan.approve', 'payroll.loan.manage',
        'reports.payroll.view', 'reports.export'),
    ),
  },
  {
    key: 'department_manager',
    name: 'Department Manager',
    description: 'Manages people and approvals within their department.',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      grants('DEPARTMENT', 'employee.view', 'attendance.view', 'attendance.regularize.approve', 'attendance.timesheet.approve',
        'leave.view', 'leave.approve', 'performance.view', 'performance.review', 'performance.pip.manage', 'performance.okr.manage',
        'training.assign', 'exit.view', 'exit.approve', 'payroll.reimbursement.approve', 'travel.approve', 'assets.view',
        'onboarding.view', 'onboarding.confirmation.approve', 'reports.view',
        'recruitment.requisition.create', 'recruitment.requisition.approve', 'recruitment.interview.feedback'),
    ),
  },
  {
    key: 'team_lead',
    name: 'Team Lead',
    description: 'Leads a team; approves leave and attendance for direct reports.',
    locked: false,
    grants: merge(
      EMPLOYEE_SELF_SERVICE,
      grants('TEAM', 'employee.view', 'attendance.view', 'attendance.regularize.approve', 'attendance.timesheet.approve',
        'leave.view', 'leave.approve', 'performance.view', 'performance.review',
        'recruitment.interview.feedback', 'reports.view', 'travel.approve', 'assets.view'),
    ),
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Employee self-service access.',
    locked: false,
    grants: EMPLOYEE_SELF_SERVICE,
  },
  {
    key: 'auditor',
    name: 'Auditor',
    description: 'Read-only access to records, reports and audit trails. No sensitive identifiers.',
    locked: false,
    grants: grants(ORG, ...READ_ONLY_KEYS),
  },
];

export function getRoleTemplate(key: string): SystemRoleTemplate | undefined {
  return SYSTEM_ROLE_TEMPLATES.find((r) => r.key === key);
}
