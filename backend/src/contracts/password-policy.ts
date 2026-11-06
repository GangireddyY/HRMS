import type { PasswordPolicy } from './api';

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
  historyCount: 5,
  maxAgeDays: 0,
};

/** Absolute floor no organization policy can go below. */
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Validates a password against a policy. Returns human-readable violations (empty when valid).
 * Shared by the API (authoritative) and the web app (instant feedback).
 */
export function validatePassword(password: string, policy: PasswordPolicy): string[] {
  const issues: string[] = [];
  const min = Math.max(policy.minLength, PASSWORD_MIN_LENGTH_FLOOR);
  if (password.length < min) issues.push(`Must be at least ${min} characters`);
  if (password.length > PASSWORD_MAX_LENGTH) issues.push(`Must be at most ${PASSWORD_MAX_LENGTH} characters`);
  if (policy.requireUppercase && !/[A-Z]/.test(password)) issues.push('Must contain an uppercase letter');
  if (policy.requireLowercase && !/[a-z]/.test(password)) issues.push('Must contain a lowercase letter');
  if (policy.requireNumber && !/[0-9]/.test(password)) issues.push('Must contain a number');
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) issues.push('Must contain a symbol');
  return issues;
}

/** Combines several policies into the strictest one (used when a user belongs to multiple organizations). */
export function strictestPolicy(policies: PasswordPolicy[]): PasswordPolicy {
  if (policies.length === 0) return { ...DEFAULT_PASSWORD_POLICY };
  return policies.reduce((acc, p) => ({
    minLength: Math.max(acc.minLength, p.minLength),
    requireUppercase: acc.requireUppercase || p.requireUppercase,
    requireLowercase: acc.requireLowercase || p.requireLowercase,
    requireNumber: acc.requireNumber || p.requireNumber,
    requireSymbol: acc.requireSymbol || p.requireSymbol,
    historyCount: Math.max(acc.historyCount, p.historyCount),
    maxAgeDays: minPositive(acc.maxAgeDays, p.maxAgeDays),
  }));
}

/** 0 means "never expires"; the strictest non-zero value wins. */
function minPositive(a: number, b: number): number {
  if (a === 0) return b;
  if (b === 0) return a;
  return Math.min(a, b);
}
