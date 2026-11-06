import type { Component } from 'vue';
import {
  Activity,
  Award,
  BadgeCheck,
  Banknote,
  Bell,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  ClockAlert,
  Fingerprint,
  CreditCard,
  FileClock,
  FilePlus2,
  FileText,
  FileWarning,
  Gauge,
  GraduationCap,
  HeartPulse,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  Megaphone,
  MessagesSquare,
  Network,
  Palette,
  Plane,
  Receipt,
  RefreshCcw,
  Rocket,
  Scale,
  Server,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  User,
  UserSearch,
  Users,
  Wallet,
} from '@lucide/vue';
import { isAllowed, type AccessRule, type AccessSubject } from '@/core/navigation/access-rules';

export type WorkspaceKey = 'platform' | 'admin' | 'hr' | 'me';

export interface NavItem {
  label: string;
  to: string;
  icon: Component;
  access?: AccessRule;
  /** Highlight only on exact path match. */
  exact?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export interface Workspace {
  key: WorkspaceKey;
  label: string;
  description: string;
  icon: Component;
  home: string;
  access: AccessRule | ((s: AccessSubject) => boolean);
  sections: NavSection[];
}

/**
 * Permissions that indicate HR operations responsibilities (beyond self-service).
 * Scopable ones count only at TEAM scope or wider.
 */
export const HR_OPERATIONS_PERMISSIONS = [
  'employee.view', 'employee.create', 'employee.lifecycle.manage', 'recruitment.view', 'recruitment.requisition.create', 'recruitment.requisition.approve',
  'onboarding.view', 'onboarding.manage', 'onboarding.confirmation.approve', 'attendance.view', 'attendance.manage', 'attendance.regularize.approve', 'attendance.close', 'attendance.configure',
  'leave.view', 'leave.approve', 'leave.allocate', 'leave.configure',
  'payroll.view', 'payroll.configure', 'payroll.reimbursement.approve', 'employee.salary.view', 'performance.view', 'performance.review', 'performance.pip.manage', 'performance.configure', 'training.manage', 'training.assign',
  'engagement.announcement.manage', 'engagement.survey.manage', 'grievance.view', 'grievance.manage', 'grievance.posh.access', 'benefits.manage', 'compliance.manage', 'exit.view', 'exit.manage', 'reports.view',
];

export const ADMIN_PERMISSIONS = ['organization.update', 'organization.security.manage', 'user.view', 'role.view', 'audit.view', 'audit.login_history.view'];

export const WORKSPACES: Workspace[] = [
  {
    key: 'platform',
    label: 'Platform',
    description: 'Tenants, plans and platform governance',
    icon: Server,
    home: '/platform',
    access: { platform: 'platform.organizations.view' },
    sections: [
      { items: [{ label: 'Dashboard', to: '/platform', icon: LayoutDashboard, exact: true }] },
      {
        title: 'Tenants',
        items: [
          { label: 'Organizations', to: '/platform/organizations', icon: Building2 },
          { label: 'Plans & entitlements', to: '/platform/plans', icon: CreditCard },
        ],
      },
      { title: 'Governance', items: [{ label: 'Audit log', to: '/platform/audit-logs', icon: FileClock, access: { platform: 'platform.audit.view' } }] },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    description: 'Organization settings, users and access control',
    icon: Settings,
    home: '/admin',
    access: { permissions: ADMIN_PERMISSIONS },
    sections: [
      { items: [{ label: 'Dashboard', to: '/admin', icon: Gauge, exact: true, access: { permissions: ['organization.view'] } }] },
      {
        title: 'Organization',
        items: [
          { label: 'Settings', to: '/admin/organization', icon: Building2, access: { permissions: ['organization.view'] } },
          { label: 'Structure', to: '/admin/structure', icon: Network, access: { permissions: ['organization.view'] } },
          { label: 'Holidays', to: '/admin/holidays', icon: CalendarDays, access: { permissions: ['organization.view'] } },
        ],
      },
      {
        title: 'Access control',
        items: [
          { label: 'Users', to: '/admin/users', icon: Users, access: { permissions: ['user.view'] } },
          { label: 'Roles & permissions', to: '/admin/roles', icon: ShieldCheck, access: { permissions: ['role.view'] } },
        ],
      },
      {
        title: 'Governance',
        items: [
          { label: 'Audit log', to: '/admin/audit-logs', icon: FileClock, access: { permissions: ['audit.view'] } },
          { label: 'Login history', to: '/admin/login-history', icon: History, access: { permissions: ['audit.login_history.view'] } },
        ],
      },
    ],
  },
  {
    key: 'hr',
    label: 'HR Operations',
    description: 'People operations across the employee lifecycle',
    icon: Briefcase,
    home: '/hr',
    access: { permissions: HR_OPERATIONS_PERMISSIONS, scope: 'TEAM' },
    sections: [
      { items: [{ label: 'HR dashboard', to: '/hr', icon: Activity, exact: true }] },
      {
        title: 'People',
        items: [
          { label: 'Employees', to: '/hr/employees', icon: Users, access: { permissions: ['employee.view'], scope: 'TEAM' } },
          { label: 'Org chart', to: '/hr/org-chart', icon: Network, access: { permissions: ['employee.view'], scope: 'TEAM' } },
          { label: 'Document expiry', to: '/hr/documents/expiring', icon: FileWarning, access: { permissions: ['employee.document.manage'] } },
        ],
      },
      {
        title: 'Recruitment',
        items: [
          { label: 'Requisitions', to: '/hr/recruitment/requisitions', icon: FilePlus2, access: { permissions: ['recruitment.requisition.create', 'recruitment.requisition.approve', 'recruitment.view'], scope: 'TEAM', feature: 'recruitment' } },
          { label: 'Jobs', to: '/hr/recruitment/jobs', icon: BriefcaseBusiness, access: { permissions: ['recruitment.view'], feature: 'recruitment' } },
          { label: 'Candidates', to: '/hr/recruitment/candidates', icon: UserSearch, access: { permissions: ['recruitment.view'], feature: 'recruitment' } },
        ],
      },
      {
        title: 'Onboarding',
        items: [
          { label: 'Onboarding', to: '/hr/onboarding', icon: Rocket, exact: true, access: { permissions: ['onboarding.view'], scope: 'TEAM' } },
          { label: 'Probation', to: '/hr/onboarding/probation', icon: BadgeCheck, access: { permissions: ['onboarding.view', 'onboarding.confirmation.approve'], scope: 'TEAM' } },
          { label: 'Checklists', to: '/hr/onboarding/checklists', icon: ListChecks, access: { permissions: ['onboarding.manage'] } },
        ],
      },
      {
        title: 'Attendance',
        items: [
          { label: 'Register', to: '/hr/attendance', icon: ClipboardList, exact: true, access: { permissions: ['attendance.view'], scope: 'TEAM' } },
          { label: 'Regularizations', to: '/hr/attendance/regularizations', icon: ClockAlert, access: { permissions: ['attendance.regularize.approve'], scope: 'TEAM' } },
          { label: 'Monthly closing', to: '/hr/attendance/closing', icon: CalendarCheck, access: { permissions: ['attendance.close'] } },
          { label: 'Shifts', to: '/hr/attendance/shifts', icon: Clock, access: { permissions: ['attendance.configure'] } },
        ],
      },
      {
        title: 'Leave',
        items: [
          { label: 'Leave requests', to: '/hr/leave/requests', icon: CalendarClock, access: { permissions: ['leave.approve', 'leave.view'], scope: 'TEAM' } },
          { label: 'Team calendar', to: '/hr/leave/calendar', icon: CalendarRange, access: { permissions: ['leave.view'], scope: 'TEAM' } },
          { label: 'Balances', to: '/hr/leave/balances', icon: Scale, access: { permissions: ['leave.view'], scope: 'TEAM' } },
          { label: 'Leave types', to: '/hr/leave/types', icon: Settings2, access: { permissions: ['leave.configure'] } },
        ],
      },
      {
        title: 'Payroll',
        items: [
          { label: 'Payroll runs', to: '/hr/payroll/runs', icon: Banknote, access: { permissions: ['payroll.view'], feature: 'payroll' } },
          { label: 'Salaries', to: '/hr/payroll/salaries', icon: Wallet, access: { permissions: ['employee.salary.view'], scope: 'TEAM', feature: 'payroll' } },
          { label: 'Reimbursements', to: '/hr/payroll/reimbursements', icon: Receipt, access: { permissions: ['payroll.reimbursement.approve', 'payroll.view'], scope: 'TEAM', feature: 'payroll' } },
          { label: 'Payroll setup', to: '/hr/payroll/setup', icon: SlidersHorizontal, access: { permissions: ['payroll.configure', 'payroll.view'], feature: 'payroll' } },
        ],
      },
      {
        title: 'Performance',
        items: [
          { label: 'Reviews', to: '/hr/performance/reviews', icon: Target, access: { permissions: ['performance.review', 'performance.view', 'performance.configure'], scope: 'TEAM', feature: 'performance' } },
          { label: 'Review cycles', to: '/hr/performance/cycles', icon: RefreshCcw, access: { permissions: ['performance.configure', 'performance.view'], scope: 'TEAM', feature: 'performance' } },
          { label: 'Improvement plans', to: '/hr/performance/pips', icon: LifeBuoy, access: { permissions: ['performance.pip.manage'], scope: 'TEAM', feature: 'performance' } },
        ],
      },
      {
        title: 'Training',
        items: [
          { label: 'Courses', to: '/hr/training/courses', icon: GraduationCap, access: { permissions: ['training.manage', 'training.assign'], scope: 'TEAM', feature: 'training' } },
          { label: 'Team training', to: '/hr/training/team', icon: Award, access: { permissions: ['training.manage', 'training.assign'], scope: 'TEAM', feature: 'training' } },
        ],
      },
      {
        title: 'Engagement',
        items: [
          { label: 'Announcements', to: '/hr/engagement/announcements', icon: Megaphone, access: { permissions: ['engagement.announcement.manage'], feature: 'engagement' } },
          { label: 'Surveys', to: '/hr/engagement/surveys', icon: ClipboardList, access: { permissions: ['engagement.survey.manage'], feature: 'engagement' } },
          { label: 'Suggestions', to: '/hr/engagement/suggestions', icon: Lightbulb, access: { permissions: ['engagement.survey.manage'], feature: 'engagement' } },
        ],
      },
      {
        title: 'Employee relations',
        items: [
          { label: 'Grievances', to: '/hr/grievances', icon: ShieldAlert, access: { permissions: ['grievance.view', 'grievance.manage', 'grievance.posh.access'], feature: 'grievance' } },
          { label: 'POSH annual report', to: '/hr/grievances/posh-report', icon: FileText, access: { permissions: ['grievance.posh.access'], feature: 'grievance' } },
        ],
      },
      {
        title: 'Benefits',
        items: [
          { label: 'Benefit plans', to: '/hr/benefits/plans', icon: HeartPulse, access: { permissions: ['benefits.manage'], feature: 'benefits' } },
          { label: 'Enrolments', to: '/hr/benefits/enrollments', icon: ClipboardCheck, access: { permissions: ['benefits.manage'], feature: 'benefits' } },
        ],
      },
    ],
  },
  {
    key: 'me',
    label: 'My Workspace',
    description: 'Your profile, security and requests',
    icon: User,
    home: '/me',
    access: () => true,
    sections: [
      {
        items: [
          { label: 'Home', to: '/me', icon: Home, exact: true, access: { tenant: true } },
          { label: 'Company', to: '/me/engagement', icon: Megaphone, access: { permissions: ['engagement.view'], feature: 'engagement' } },
        ],
      },
      {
        title: 'Work',
        items: [
          { label: 'My employment', to: '/me/employment', icon: BriefcaseBusiness, access: { tenant: true } },
          { label: 'Onboarding', to: '/me/onboarding', icon: Rocket, access: { tenant: true, feature: 'onboarding' } },
          { label: 'Interviews', to: '/me/interviews', icon: MessagesSquare, access: { permissions: ['recruitment.interview.feedback'], feature: 'recruitment' } },
          { label: 'Attendance', to: '/me/attendance', icon: Fingerprint, access: { permissions: ['attendance.view'] } },
          { label: 'Leave', to: '/me/leave', icon: Plane, access: { permissions: ['leave.view'] } },
          { label: 'Performance', to: '/me/performance', icon: Target, access: { tenant: true, feature: 'performance' } },
          { label: 'Learning', to: '/me/training', icon: GraduationCap, access: { tenant: true, feature: 'training' } },
          { label: 'Payslips', to: '/me/payslips', icon: FileText, access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } },
          { label: 'Salary & tax', to: '/me/salary', icon: Wallet, access: { tenant: true, feature: 'payroll' } },
          { label: 'Reimbursements', to: '/me/reimbursements', icon: Receipt, access: { permissions: ['payroll.reimbursement.apply'], feature: 'payroll' } },
          { label: 'Benefits', to: '/me/benefits', icon: HeartPulse, access: { permissions: ['benefits.view'], feature: 'benefits' } },
          { label: 'Grievances', to: '/me/grievances', icon: ShieldAlert, access: { permissions: ['grievance.submit'], feature: 'grievance' } },
        ],
      },
      {
        title: 'Account',
        items: [
          { label: 'Profile', to: '/me/profile', icon: User },
          { label: 'Security', to: '/me/security', icon: KeyRound },
          { label: 'Appearance', to: '/me/appearance', icon: Palette },
          { label: 'Notifications', to: '/me/notifications', icon: Bell },
        ],
      },
    ],
  },
];

export function canAccessWorkspace(ws: Workspace, subject: AccessSubject): boolean {
  return typeof ws.access === 'function' ? ws.access(subject) : isAllowed(ws.access, subject);
}

export function accessibleWorkspaces(subject: AccessSubject): Workspace[] {
  return WORKSPACES.filter((ws) => canAccessWorkspace(ws, subject));
}

/** Menu sections filtered to items the subject may open; empty sections are dropped. */
export function visibleSections(ws: Workspace, subject: AccessSubject): NavSection[] {
  return ws.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => isAllowed(i.access, subject)) }))
    .filter((s) => s.items.length > 0);
}

/** Landing page after sign-in. */
export function homePath(subject: AccessSubject): string {
  const order: WorkspaceKey[] = subject.hasOrganization ? ['admin', 'hr', 'me', 'platform'] : ['platform', 'me'];
  for (const key of order) {
    const ws = WORKSPACES.find((w) => w.key === key)!;
    if (!canAccessWorkspace(ws, subject)) continue;
    const first = visibleSections(ws, subject)[0]?.items[0];
    if (first) return first.to;
  }
  return '/me/profile';
}
