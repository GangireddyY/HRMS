import type { Component } from 'vue';
import {
  Activity,
  Bell,
  Briefcase,
  BriefcaseBusiness,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  Clock,
  ClockAlert,
  Fingerprint,
  CreditCard,
  FileClock,
  FileWarning,
  Gauge,
  History,
  Home,
  KeyRound,
  LayoutDashboard,
  Network,
  Palette,
  Server,
  Settings,
  ShieldCheck,
  User,
  Users,
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
  'employee.view', 'employee.create', 'employee.lifecycle.manage', 'recruitment.view', 'recruitment.requisition.approve',
  'onboarding.view', 'attendance.view', 'attendance.manage', 'attendance.regularize.approve', 'attendance.close', 'attendance.configure',
  'leave.view', 'leave.approve', 'leave.allocate',
  'payroll.view', 'performance.view', 'performance.configure', 'training.manage', 'training.assign',
  'engagement.announcement.manage', 'grievance.view', 'benefits.manage', 'compliance.manage', 'exit.view', 'exit.manage', 'reports.view',
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
        title: 'Attendance',
        items: [
          { label: 'Register', to: '/hr/attendance', icon: ClipboardList, exact: true, access: { permissions: ['attendance.view'], scope: 'TEAM' } },
          { label: 'Regularizations', to: '/hr/attendance/regularizations', icon: ClockAlert, access: { permissions: ['attendance.regularize.approve'], scope: 'TEAM' } },
          { label: 'Monthly closing', to: '/hr/attendance/closing', icon: CalendarCheck, access: { permissions: ['attendance.close'] } },
          { label: 'Shifts', to: '/hr/attendance/shifts', icon: Clock, access: { permissions: ['attendance.configure'] } },
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
      { items: [{ label: 'Home', to: '/me', icon: Home, exact: true, access: { tenant: true } }] },
      {
        title: 'Work',
        items: [
          { label: 'My employment', to: '/me/employment', icon: BriefcaseBusiness, access: { tenant: true } },
          { label: 'Attendance', to: '/me/attendance', icon: Fingerprint, access: { permissions: ['attendance.view'] } },
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
