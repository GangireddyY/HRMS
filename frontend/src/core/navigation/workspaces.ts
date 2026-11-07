import type { Component } from 'vue';
import {
  Activity,
  Award,
  BarChart3,
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
  DoorOpen,
  Fingerprint,
  CreditCard,
  FileClock,
  FilePlus2,
  FileText,
  FileWarning,
  Gauge,
  GraduationCap,
  Grid3x3,
  HandCoins,
  Handshake,
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
  ScrollText,
  Scale,
  Server,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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
  /**
   * Pages on the bottom tab bar of phones and tablets, in order of preference (the first three the user may open),
   * with a short label where the menu label doesn't fit.
   */
  mobileTabs: { to: string; label?: string }[];
}

/**
 * Permissions that indicate HR operations responsibilities (beyond self-service).
 * Scopable ones count only at TEAM scope or wider.
 */
export const HR_OPERATIONS_PERMISSIONS = [
  'employee.view', 'employee.create', 'employee.lifecycle.manage', 'recruitment.view', 'recruitment.requisition.create', 'recruitment.requisition.approve',
  'onboarding.view', 'onboarding.manage', 'onboarding.confirmation.approve', 'attendance.view', 'attendance.manage', 'attendance.regularize.approve', 'attendance.close', 'attendance.configure',
  'leave.view', 'leave.approve', 'leave.allocate', 'leave.configure',
  'payroll.view', 'payroll.configure', 'payroll.reimbursement.approve', 'payroll.loan.approve', 'payroll.loan.manage', 'employee.salary.view', 'performance.view', 'performance.review', 'performance.pip.manage', 'performance.configure', 'training.manage', 'training.assign',
  'engagement.announcement.manage', 'engagement.survey.manage', 'grievance.view', 'grievance.manage', 'grievance.posh.access', 'benefits.manage', 'compliance.manage', 'exit.view', 'exit.approve', 'exit.manage', 'exit.clearance.manage', 'payroll.settlement.manage', 'reports.view', 'reports.payroll.view', 'reports.recruitment.view',
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
    mobileTabs: [{ to: '/platform', label: 'Overview' }, { to: '/platform/organizations', label: 'Tenants' }, { to: '/platform/plans', label: 'Plans' }, { to: '/platform/audit-logs', label: 'Audit' }],
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
    mobileTabs: [{ to: '/admin', label: 'Overview' }, { to: '/admin/users' }, { to: '/admin/roles', label: 'Roles' }, { to: '/admin/organization', label: 'Settings' }, { to: '/admin/audit-logs', label: 'Audit' }],
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
    mobileTabs: [
      { to: '/hr', label: 'Overview' },
      { to: '/hr/employees', label: 'People' },
      { to: '/hr/leave/requests', label: 'Leave' },
      { to: '/hr/attendance/regularizations', label: 'Approvals' },
      { to: '/hr/payroll/runs', label: 'Payroll' },
      { to: '/hr/recruitment/jobs', label: 'Jobs' },
    ],
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
          { label: 'Approvals', to: '/hr/attendance/regularizations', icon: ClockAlert, access: { permissions: ['attendance.regularize.approve'], scope: 'TEAM' } },
          { label: 'Roster', to: '/hr/attendance/roster', icon: CalendarDays, access: { permissions: ['attendance.configure', 'attendance.view'], scope: 'TEAM' } },
          { label: 'Monthly closing', to: '/hr/attendance/closing', icon: CalendarCheck, access: { permissions: ['attendance.close'] } },
          { label: 'Shifts', to: '/hr/attendance/shifts', icon: Clock, access: { permissions: ['attendance.configure'] } },
          { label: 'Devices', to: '/hr/attendance/devices', icon: Fingerprint, access: { permissions: ['attendance.configure'] } },
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
          { label: 'Loans & advances', to: '/hr/payroll/loans', icon: HandCoins, access: { permissions: ['payroll.loan.approve', 'payroll.loan.manage', 'payroll.view'], feature: 'payroll' } },
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
          { label: 'Skill matrix', to: '/hr/training/skills', icon: Grid3x3, access: { permissions: ['training.manage', 'training.assign'], scope: 'TEAM', feature: 'training' } },
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
      {
        title: 'Compliance',
        items: [
          { label: 'Policies', to: '/hr/compliance/policies', icon: ScrollText, access: { permissions: ['compliance.manage'], feature: 'compliance' } },
          { label: 'Statutory calendar', to: '/hr/compliance/calendar', icon: CalendarClock, access: { permissions: ['compliance.manage'], feature: 'compliance' } },
        ],
      },
      {
        title: 'Exits',
        items: [
          { label: 'Exits', to: '/hr/exits', icon: DoorOpen, access: { permissions: ['exit.view', 'exit.approve', 'exit.manage', 'exit.clearance.manage', 'payroll.settlement.manage'], scope: 'TEAM', feature: 'exit' } },
          { label: 'Alumni', to: '/hr/alumni', icon: Handshake, access: { permissions: ['exit.manage', 'exit.view'], scope: 'TEAM', feature: 'exit' } },
        ],
      },
      {
        title: 'Insights',
        items: [
          { label: 'Reports', to: '/hr/reports', icon: BarChart3, access: { permissions: ['reports.view', 'reports.payroll.view', 'reports.recruitment.view'], scope: 'TEAM', feature: 'reports' } },
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
    mobileTabs: [{ to: '/me' }, { to: '/me/leave' }, { to: '/me/attendance', label: 'Attend' }, { to: '/me/payslips', label: 'Pay' }, { to: '/me/profile' }],
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
          { label: 'Skills', to: '/me/skills', icon: Sparkles, access: { permissions: ['training.view'], feature: 'training' } },
          { label: 'Payslips', to: '/me/payslips', icon: FileText, access: { permissions: ['payroll.payslip.view'], feature: 'payroll' } },
          { label: 'Salary & tax', to: '/me/salary', icon: Wallet, access: { tenant: true, feature: 'payroll' } },
          { label: 'Reimbursements', to: '/me/reimbursements', icon: Receipt, access: { permissions: ['payroll.reimbursement.apply'], feature: 'payroll' } },
          { label: 'Loans & advances', to: '/me/loans', icon: HandCoins, access: { permissions: ['payroll.loan.apply'], feature: 'payroll' } },
          { label: 'Benefits', to: '/me/benefits', icon: HeartPulse, access: { permissions: ['benefits.view'], feature: 'benefits' } },
          { label: 'Policies', to: '/me/policies', icon: ScrollText, access: { permissions: ['compliance.view'], feature: 'compliance' } },
          { label: 'Grievances', to: '/me/grievances', icon: ShieldAlert, access: { permissions: ['grievance.submit'], feature: 'grievance' } },
          { label: 'Resignation & exit', to: '/me/exit', icon: DoorOpen, access: { permissions: ['exit.resign'], feature: 'exit' } },
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

/** The three bottom-tab pages of a workspace on phones and tablets, from its preferences then its menu. */
export function mobileTabItems(ws: Workspace, subject: AccessSubject): NavItem[] {
  const items = visibleSections(ws, subject).flatMap((s) => s.items);
  const byPath = new Map(items.map((i) => [i.to, i]));
  const preferred = ws.mobileTabs.flatMap((t) => {
    const item = byPath.get(t.to);
    return item ? [{ ...item, label: t.label ?? item.label }] : [];
  });
  const rest = items.filter((i) => !preferred.some((p) => p.to === i.to));
  return [...preferred, ...rest].slice(0, 3);
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
