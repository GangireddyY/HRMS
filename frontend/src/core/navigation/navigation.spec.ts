import { describe, expect, it } from 'vitest';
import { scopeCovers, type ModuleKey, type PermissionScope } from '@contracts';
import { isAllowed, type AccessSubject } from '@/core/navigation/access-rules';
import { WORKSPACES, accessibleWorkspaces, homePath, visibleSections } from '@/core/navigation/workspaces';

function subject(perms: Record<string, PermissionScope>, opts: { platform?: boolean; org?: boolean; features?: ModuleKey[] } = {}): AccessSubject {
  return {
    can: (p, scope = 'OWN') => !!perms[p] && scopeCovers(perms[p], scope),
    hasFeature: (m) => (opts.features ?? ['core', 'employee', 'leave']).includes(m),
    canPlatform: () => !!opts.platform,
    hasOrganization: opts.org ?? true,
  };
}

describe('isAllowed', () => {
  it('allows rules without requirements', () => {
    expect(isAllowed(undefined, subject({}))).toBe(true);
  });

  it('requires any of the listed permissions', () => {
    const rule = { permissions: ['user.view', 'role.view'] };
    expect(isAllowed(rule, subject({ 'role.view': 'ORGANIZATION' }))).toBe(true);
    expect(isAllowed(rule, subject({ 'leave.apply': 'ORGANIZATION' }))).toBe(false);
  });

  it('enforces minimum scope for scopable permissions', () => {
    const rule = { permissions: ['leave.view'], scope: 'TEAM' as const };
    expect(isAllowed(rule, subject({ 'leave.view': 'OWN' }))).toBe(false);
    expect(isAllowed(rule, subject({ 'leave.view': 'DEPARTMENT' }))).toBe(true);
  });

  it('requires an organization context for tenant permissions', () => {
    expect(isAllowed({ permissions: ['user.view'] }, subject({ 'user.view': 'ORGANIZATION' }, { org: false }))).toBe(false);
  });

  it('requires feature entitlement when specified', () => {
    expect(isAllowed({ feature: 'payroll' }, subject({}))).toBe(false);
    expect(isAllowed({ feature: 'leave' }, subject({}))).toBe(true);
  });

  it('checks platform permissions', () => {
    expect(isAllowed({ platform: 'platform.organizations.view' }, subject({}))).toBe(false);
    expect(isAllowed({ platform: 'platform.organizations.view' }, subject({}, { platform: true }))).toBe(true);
  });
});

describe('workspaces', () => {
  const employee = subject({ 'leave.apply': 'ORGANIZATION', 'leave.view': 'OWN', 'self.profile.update': 'ORGANIZATION' });
  const orgAdmin = subject({ 'organization.view': 'ORGANIZATION', 'user.view': 'ORGANIZATION', 'role.view': 'ORGANIZATION', 'audit.view': 'ORGANIZATION' });
  const superAdmin = subject({}, { platform: true, org: false });

  it('gives employees only self-service', () => {
    expect(accessibleWorkspaces(employee).map((w) => w.key)).toEqual(['me']);
    expect(homePath(employee)).toBe('/me');
  });

  it('does not expose menu items without permission', () => {
    const admin = WORKSPACES.find((w) => w.key === 'admin')!;
    const limited = subject({ 'user.view': 'ORGANIZATION' });
    const labels = visibleSections(admin, limited).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toEqual(['Users']);
  });

  it('lands org admins on the administration dashboard', () => {
    expect(homePath(orgAdmin)).toBe('/admin');
  });

  it('lands super admins without an organization on the platform', () => {
    expect(accessibleWorkspaces(superAdmin).map((w) => w.key)).toEqual(['platform', 'me']);
    expect(homePath(superAdmin)).toBe('/platform');
  });

  it('puts suggestions in My Workspace and billing on the platform phone tabs', () => {
    const me = WORKSPACES.find((w) => w.key === 'me')!;
    const viewer = subject({ 'engagement.view': 'ORGANIZATION' }, { features: ['core', 'employee', 'engagement'] });
    const labels = visibleSections(me, viewer).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain('Suggestions');
    const platform = WORKSPACES.find((w) => w.key === 'platform')!;
    expect(platform.mobileTabs.map((t) => t.to)).toContain('/platform/billing');
  });

  it('lists bank account changes for people who can see sensitive employee details', () => {
    const hr = WORKSPACES.find((w) => w.key === 'hr')!;
    const viewer = subject({ 'employee.sensitive.view': 'ORGANIZATION' });
    const labels = visibleSections(hr, viewer).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain('Bank changes');
  });

  it('lists salary revisions next to salaries for team salary viewers', () => {
    const hr = WORKSPACES.find((w) => w.key === 'hr')!;
    const viewer = subject({ 'employee.salary.view': 'TEAM' }, { features: ['core', 'employee', 'payroll'] });
    const labels = visibleSections(hr, viewer).flatMap((s) => s.items.map((i) => i.label));
    expect(labels).toContain('Salary revisions');
    expect(labels.indexOf('Salary revisions')).toBe(labels.indexOf('Salaries') + 1);
  });

  it('opens the HR workspace only with team-or-wider HR permissions', () => {
    expect(accessibleWorkspaces(subject({ 'leave.approve': 'TEAM' })).some((w) => w.key === 'hr')).toBe(true);
    expect(accessibleWorkspaces(subject({ 'leave.view': 'OWN' })).some((w) => w.key === 'hr')).toBe(false);
  });
});
