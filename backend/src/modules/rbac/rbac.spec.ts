import { ModuleKey, PermissionScope } from '../../contracts';
import { computeEntitlements, foldPermissions } from './access.service';
import { findEscalations } from './escalation';

const ALL: Set<ModuleKey> = new Set(['core', 'employee', 'leave', 'payroll', 'grievance']);

describe('foldPermissions', () => {
  it('unions grants across roles and keeps the broadest scope', () => {
    const map = foldPermissions(
      [
        { key: 'leave.view', scope: 'OWN' },
        { key: 'leave.view', scope: 'DEPARTMENT' },
        { key: 'leave.apply', scope: 'OWN' },
      ],
      ALL,
    );
    expect(map.get('leave.view')).toBe('DEPARTMENT');
    expect(map.get('leave.apply')).toBe('ORGANIZATION');
  });

  it('drops permissions of modules the organization is not entitled to', () => {
    const map = foldPermissions([{ key: 'payroll.view', scope: 'ORGANIZATION' }], new Set<ModuleKey>(['core']));
    expect(map.has('payroll.view')).toBe(false);
  });

  it('ignores unknown permission keys', () => {
    expect(foldPermissions([{ key: 'made.up', scope: 'OWN' }], ALL).size).toBe(0);
  });
});

describe('computeEntitlements', () => {
  it('always includes core modules', () => {
    expect(computeEntitlements([], []).has('core')).toBe(true);
  });

  it('applies plan features and overrides', () => {
    const set = computeEntitlements(['employee', 'leave'], [
      { key: 'leave', enabled: false },
      { key: 'payroll', enabled: true },
    ]);
    expect([...set].sort()).toEqual(['core', 'employee', 'payroll']);
  });

  it('cannot disable core modules', () => {
    expect(computeEntitlements([], [{ key: 'core', enabled: false }]).has('core')).toBe(true);
  });
});

describe('findEscalations', () => {
  const actor = new Map<string, PermissionScope>([
    ['leave.view', 'DEPARTMENT'],
    ['leave.approve', 'DEPARTMENT'],
    ['user.view', 'ORGANIZATION'],
  ]);

  it('allows granting held permissions at the same or narrower scope', () => {
    expect(findEscalations(actor, ALL, [{ key: 'leave.view', scope: 'TEAM' }, { key: 'leave.approve', scope: 'DEPARTMENT' }])).toEqual([]);
  });

  it('blocks broader scopes and unheld permissions', () => {
    expect(findEscalations(actor, ALL, [{ key: 'leave.view', scope: 'ORGANIZATION' }, { key: 'payroll.approve', scope: 'ORGANIZATION' }])).toEqual([
      'leave.view',
      'payroll.approve',
    ]);
  });

  it('lets role managers assign restricted permissions they do not hold', () => {
    const manager = new Map<string, PermissionScope>([['role.manage', 'ORGANIZATION']]);
    expect(findEscalations(manager, ALL, [{ key: 'grievance.posh.access', scope: 'ORGANIZATION' }])).toEqual([]);
    expect(findEscalations(actor, ALL, [{ key: 'grievance.posh.access', scope: 'ORGANIZATION' }])).toEqual(['grievance.posh.access']);
  });

  it('skips grants in modules that are not entitled', () => {
    expect(findEscalations(actor, new Set<ModuleKey>(['core']), [{ key: 'payroll.approve', scope: 'ORGANIZATION' }])).toEqual([]);
  });
});
