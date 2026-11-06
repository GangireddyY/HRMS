import { combinePolicies, DEFAULT_SECURITY_POLICY, isPasswordExpired, SecurityPolicyRow } from './security-policy.service';

function policy(overrides: Partial<SecurityPolicyRow>): SecurityPolicyRow {
  return {
    passwordMinLength: 12,
    passwordRequireUppercase: true,
    passwordRequireLowercase: true,
    passwordRequireNumber: true,
    passwordRequireSymbol: true,
    passwordHistoryCount: 5,
    passwordMaxAgeDays: 0,
    lockoutThreshold: 5,
    lockoutDurationMinutes: 15,
    sessionIdleTimeoutMinutes: 120,
    sessionMaxLifetimeHours: 168,
    mfaRequired: false,
    ...overrides,
  };
}

describe('combinePolicies', () => {
  it('falls back to defaults without organizations', () => {
    expect(combinePolicies([])).toBe(DEFAULT_SECURITY_POLICY);
  });

  it('picks the strictest values across organizations', () => {
    const merged = combinePolicies([
      policy({ lockoutThreshold: 5, lockoutDurationMinutes: 15, sessionIdleTimeoutMinutes: 60, mfaRequired: false, passwordMinLength: 10 }),
      policy({ lockoutThreshold: 3, lockoutDurationMinutes: 30, sessionIdleTimeoutMinutes: 240, mfaRequired: true, passwordMinLength: 14 }),
    ]);
    expect(merged.lockout).toEqual({ threshold: 3, durationMinutes: 30 });
    expect(merged.session.idleTimeoutMinutes).toBe(60);
    expect(merged.mfaRequired).toBe(true);
    expect(merged.password.minLength).toBe(14);
  });
});

describe('isPasswordExpired', () => {
  const now = new Date('2026-06-01T00:00:00Z');

  it('never expires when max age is 0', () => {
    expect(isPasswordExpired(new Date('2000-01-01'), 0, now)).toBe(false);
  });

  it('expires after max age', () => {
    expect(isPasswordExpired(new Date('2026-01-01T00:00:00Z'), 90, now)).toBe(true);
    expect(isPasswordExpired(new Date('2026-05-01T00:00:00Z'), 90, now)).toBe(false);
  });
});
