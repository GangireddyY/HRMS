import { Injectable, Optional } from '@nestjs/common';
import { DEFAULT_PASSWORD_POLICY, PasswordPolicy, strictestPolicy, validatePassword } from '../../contracts';
import { Op, type Transaction } from 'sequelize';
import { AppError } from '../../common/errors/app-error';
import { OrganizationMembership, OrganizationSecurityPolicy, PasswordHistory, User } from '../../database/models';
import { AppConfig } from '../../config/app-config.service';
import { BreachedPasswordService } from '../../infrastructure/crypto/breached-password.service';
import { PasswordHasher } from '../../infrastructure/crypto/password-hasher.service';
import type { SessionLimits } from './session.service';

export interface LockoutPolicy {
  threshold: number;
  durationMinutes: number;
}

export interface EffectiveSecurityPolicy {
  password: PasswordPolicy;
  lockout: LockoutPolicy;
  session: SessionLimits;
  mfaRequired: boolean;
}

/** The policy columns, independent of the ORM row type (also used by unit tests). */
export interface SecurityPolicyRow {
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireNumber: boolean;
  passwordRequireSymbol: boolean;
  passwordHistoryCount: number;
  passwordMaxAgeDays: number;
  lockoutThreshold: number;
  lockoutDurationMinutes: number;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeHours: number;
  mfaRequired: boolean;
}

export const DEFAULT_SECURITY_POLICY: EffectiveSecurityPolicy = {
  password: DEFAULT_PASSWORD_POLICY,
  lockout: { threshold: 5, durationMinutes: 15 },
  session: { idleTimeoutMinutes: 120, maxLifetimeHours: 168 },
  mfaRequired: false,
};

export function toPasswordPolicy(p: SecurityPolicyRow): PasswordPolicy {
  return {
    minLength: p.passwordMinLength,
    requireUppercase: p.passwordRequireUppercase,
    requireLowercase: p.passwordRequireLowercase,
    requireNumber: p.passwordRequireNumber,
    requireSymbol: p.passwordRequireSymbol,
    historyCount: p.passwordHistoryCount,
    maxAgeDays: p.passwordMaxAgeDays,
  };
}

/** Strictest combination of several organization policies (a user may belong to many organizations). */
export function combinePolicies(policies: SecurityPolicyRow[]): EffectiveSecurityPolicy {
  if (policies.length === 0) return DEFAULT_SECURITY_POLICY;
  return {
    password: strictestPolicy(policies.map(toPasswordPolicy)),
    lockout: {
      threshold: Math.min(...policies.map((p) => p.lockoutThreshold)),
      durationMinutes: Math.max(...policies.map((p) => p.lockoutDurationMinutes)),
    },
    session: {
      idleTimeoutMinutes: Math.min(...policies.map((p) => p.sessionIdleTimeoutMinutes)),
      maxLifetimeHours: Math.min(...policies.map((p) => p.sessionMaxLifetimeHours)),
    },
    mfaRequired: policies.some((p) => p.mfaRequired),
  };
}

export function isPasswordExpired(passwordChangedAt: Date | null, maxAgeDays: number, now = new Date()): boolean {
  if (maxAgeDays <= 0 || !passwordChangedAt) return false;
  return now.getTime() - passwordChangedAt.getTime() > maxAgeDays * 86_400_000;
}

/**
 * Policies are read across organizations (identity-level decisions such as login and password
 * changes), so tenant auto-scoping is bypassed deliberately and filters are explicit.
 */
@Injectable()
export class SecurityPolicyService {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly config: AppConfig,
    @Optional() private readonly breached?: BreachedPasswordService,
  ) {}

  /** Two-factor sign-in is required by any of the user's organizations, and always for platform staff. */
  mfaRequiredFor(policy: EffectiveSecurityPolicy, user: { platformRole?: string | null }): boolean {
    return policy.mfaRequired || (!!user.platformRole && this.config.get('PLATFORM_MFA_REQUIRED'));
  }

  async forOrganization(organizationId: string | null): Promise<EffectiveSecurityPolicy> {
    if (!organizationId) return DEFAULT_SECURITY_POLICY;
    const policy = await OrganizationSecurityPolicy.findOne({ where: { organizationId }, skipTenantScope: true });
    return combinePolicies(policy ? [policy] : []);
  }

  /** Strictest policy across all organizations the user belongs to (any membership status). */
  async forUser(userId: string): Promise<EffectiveSecurityPolicy> {
    const memberships = await OrganizationMembership.findAll({ where: { userId }, attributes: ['organizationId'], skipTenantScope: true });
    if (!memberships.length) return DEFAULT_SECURITY_POLICY;
    const policies = await OrganizationSecurityPolicy.findAll({
      where: { organizationId: { [Op.in]: memberships.map((m) => m.organizationId) } },
      skipTenantScope: true,
    });
    return combinePolicies(policies);
  }

  /** Validates complexity, personal-information and reuse rules. Throws PASSWORD_POLICY_VIOLATION. */
  async assertAcceptable(password: string, policy: PasswordPolicy, user: { id?: string; email: string; firstName?: string; lastName?: string }): Promise<void> {
    const issues = validatePassword(password, policy);
    const lower = password.toLowerCase();
    const personal = [user.email.split('@')[0], user.firstName, user.lastName]
      .filter((v): v is string => !!v && v.length >= 3)
      .map((v) => v.toLowerCase());
    if (personal.some((v) => lower.includes(v))) issues.push('Must not contain your name or email');

    if (user.id && policy.historyCount > 0) {
      const history = await PasswordHistory.findAll({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']],
        limit: policy.historyCount,
        attributes: ['passwordHash'],
      });
      for (const h of history) {
        if (await this.hasher.verify(h.passwordHash, password)) {
          issues.push(`Must not match any of your last ${policy.historyCount} passwords`);
          break;
        }
      }
    }

    if (!issues.length && (await this.breached?.timesSeen(password))) {
      issues.push('This password has appeared in a data breach. Choose a different one.');
    }

    if (issues.length) {
      throw new AppError(
        'PASSWORD_POLICY_VIOLATION',
        'Password does not meet the security policy',
        issues.map((message) => ({ field: 'password', message })),
      );
    }
  }

  /** Hashes and stores a new password, records history and clears lockout state. */
  async setPassword(userId: string, password: string, historyCount: number, transaction?: Transaction): Promise<void> {
    const hash = await this.hasher.hash(password);
    await User.update(
      { passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      { where: { id: userId }, transaction },
    );
    await PasswordHistory.create({ userId, passwordHash: hash }, { transaction });
    const stale = await PasswordHistory.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      offset: Math.max(historyCount, 1),
      attributes: ['id'],
      transaction,
    });
    if (stale.length) await PasswordHistory.destroy({ where: { id: { [Op.in]: stale.map((s) => s.id) } }, transaction });
  }
}
