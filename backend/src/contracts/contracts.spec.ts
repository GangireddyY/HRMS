import { MODULES, PERMISSIONS, maxScope, scopeCovers } from './permissions';
import { SYSTEM_ROLE_TEMPLATES, getRoleTemplate } from './roles';
import { DEFAULT_PASSWORD_POLICY, strictestPolicy, validatePassword } from './password-policy';

describe('permission catalog', () => {
  it('has unique keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only references known modules', () => {
    const modules = new Set(MODULES.map((m) => m.key));
    for (const p of PERMISSIONS) expect(modules.has(p.module)).toBe(true);
  });

  it('uses dotted lowercase keys', () => {
    for (const p of PERMISSIONS) expect(p.key).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
  });
});

describe('scope helpers', () => {
  it('picks the broadest scope', () => {
    expect(maxScope('OWN', 'DEPARTMENT')).toBe('DEPARTMENT');
    expect(maxScope('ORGANIZATION', 'TEAM')).toBe('ORGANIZATION');
  });

  it('checks coverage', () => {
    expect(scopeCovers('DEPARTMENT', 'TEAM')).toBe(true);
    expect(scopeCovers('TEAM', 'DEPARTMENT')).toBe(false);
  });
});

describe('system role templates', () => {
  it('defines the 11 organization roles with unique keys', () => {
    const keys = SYSTEM_ROLE_TEMPLATES.map((r) => r.key);
    expect(keys).toHaveLength(11);
    expect(new Set(keys).size).toBe(11);
  });

  it('never grants restricted permissions implicitly', () => {
    const restricted = new Set(PERMISSIONS.filter((p) => p.restricted).map((p) => p.key));
    for (const role of SYSTEM_ROLE_TEMPLATES) {
      for (const g of role.grants) expect(restricted.has(g.key)).toBe(false);
    }
  });

  it('gives org admin every non-restricted permission at organization scope', () => {
    const admin = getRoleTemplate('org_admin')!;
    const expected = PERMISSIONS.filter((p) => !p.restricted).length;
    expect(admin.grants).toHaveLength(expected);
    expect(admin.grants.every((g) => g.scope === 'ORGANIZATION')).toBe(true);
  });

  it('keeps self-service grants at OWN scope for employees', () => {
    const employee = getRoleTemplate('employee')!;
    expect(employee.grants.find((g) => g.key === 'leave.view')?.scope).toBe('OWN');
    expect(employee.grants.some((g) => g.key === 'leave.approve')).toBe(false);
  });

  it('does not let self-service grants downgrade broader grants', () => {
    const hr = getRoleTemplate('hr_manager')!;
    expect(hr.grants.find((g) => g.key === 'leave.view')?.scope).toBe('ORGANIZATION');
  });

  it('separates payroll processing from approval', () => {
    const payroll = getRoleTemplate('payroll_manager')!;
    expect(payroll.grants.some((g) => g.key === 'payroll.process')).toBe(true);
    expect(payroll.grants.some((g) => g.key === 'payroll.approve')).toBe(false);
  });

  it('does not let recruiters approve their own requisitions', () => {
    const recruiter = getRoleTemplate('recruiter')!;
    expect(recruiter.grants.some((g) => g.key === 'recruitment.manage')).toBe(true);
    expect(recruiter.grants.some((g) => g.key === 'recruitment.requisition.approve')).toBe(false);
  });

  it('gives auditors read-only access without sensitive identifiers', () => {
    const auditor = getRoleTemplate('auditor')!;
    expect(auditor.grants.every((g) => g.key.endsWith('.view'))).toBe(true);
    expect(auditor.grants.some((g) => g.key === 'employee.sensitive.view')).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a compliant password', () => {
    expect(validatePassword('Str0ng!Passw0rd', DEFAULT_PASSWORD_POLICY)).toEqual([]);
  });

  it('reports each violation', () => {
    const issues = validatePassword('short', DEFAULT_PASSWORD_POLICY);
    expect(issues).toContain('Must be at least 12 characters');
    expect(issues).toContain('Must contain an uppercase letter');
    expect(issues).toContain('Must contain a number');
    expect(issues).toContain('Must contain a symbol');
  });

  it('enforces an absolute minimum length floor', () => {
    const weak = { ...DEFAULT_PASSWORD_POLICY, minLength: 4 };
    expect(validatePassword('Ab1!', weak)).toContain('Must be at least 8 characters');
  });

  it('combines policies into the strictest', () => {
    const merged = strictestPolicy([
      { ...DEFAULT_PASSWORD_POLICY, minLength: 10, requireSymbol: false, maxAgeDays: 0 },
      { ...DEFAULT_PASSWORD_POLICY, minLength: 14, requireSymbol: true, maxAgeDays: 90, historyCount: 2 },
    ]);
    expect(merged.minLength).toBe(14);
    expect(merged.requireSymbol).toBe(true);
    expect(merged.maxAgeDays).toBe(90);
    expect(merged.historyCount).toBe(5);
  });
});
