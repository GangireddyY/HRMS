import { Injectable, Logger } from '@nestjs/common';
import type { AccessContext, LoginResult, OrganizationSummary, PasswordPolicy } from '../../contracts';
import { literal, type Transaction } from 'sequelize';
import { AppConfig } from '../../config/app-config.service';
import type { AuthContext } from '../../common/auth/auth-context';
import { PaginationQueryDto, paginationArgs, paginationMeta } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors/app-error';
import { PaginatedResult } from '../../common/interceptors/response-envelope.interceptor';
import { isValidTimeZone } from '../../common/validation/validators';
import { DatabaseService } from '../../database/database.service';
import {
  ActionToken,
  ActionTokenPurpose,
  LoginEvent,
  LoginOutcome,
  MembershipRole,
  Organization,
  OrganizationMembership,
  Plan,
  RefreshToken,
  User,
  UserSession,
} from '../../database/models';
import { AuditService, diff } from '../../infrastructure/audit/audit.service';
import { PasswordHasher } from '../../infrastructure/crypto/password-hasher.service';
import { generateToken, sha256 } from '../../infrastructure/crypto/tokens';
import { MailService } from '../../infrastructure/mail/mail.service';
import { passwordResetEmail, securityAlertEmail } from '../../infrastructure/mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationProvisioningService } from '../organizations/organization-provisioning.service';
import { AccessService } from '../rbac/access.service';
import { platformPermissionsFor } from './guards/permissions.guard';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  LoginDto,
  MfaVerifyDto,
  RegisterOrganizationDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { MfaService } from './mfa.service';
import { DEFAULT_SECURITY_POLICY, LockoutPolicy, SecurityPolicyService, isPasswordExpired } from './security-policy.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

export interface ClientMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedRefresh {
  token: string;
  expiresAt: Date;
}

export interface AuthOutcome<T> {
  result: T;
  refresh?: IssuedRefresh;
}

const PASSWORD_RESET_TTL_MINUTES = 30;

/** Identity operations span organizations, so tenant-model queries here opt out of auto-scoping explicitly. */
const CROSS_TENANT = { skipTenantScope: true } as const;

const withSecrets = () => User.scope('withSecrets');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly policies: SecurityPolicyService,
    private readonly mfa: MfaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly provisioning: OrganizationProvisioningService,
    private readonly config: AppConfig,
  ) {}

  // ── Login ────────────────────────────────────────────────────────────────

  async login(dto: LoginDto, meta: ClientMeta): Promise<AuthOutcome<LoginResult>> {
    const user = await withSecrets().findOne({ where: { email: dto.email } });
    const policy = user ? await this.policies.forUser(user.id) : DEFAULT_SECURITY_POLICY;

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLogin('LOCKED', dto.email, meta, { userId: user.id, reason: 'account_locked' });
      throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed sign-in attempts. Try again later or reset your password.');
    }

    const passwordOk = await this.hasher.verify(user?.passwordHash, dto.password);
    if (!user || !passwordOk) {
      if (user) await this.registerFailure(user, policy.lockout, meta, 'invalid_password');
      else await this.recordLogin('FAILURE', dto.email, meta, { reason: 'unknown_user' });
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (user.status !== 'ACTIVE') {
      await this.recordLogin('FAILURE', dto.email, meta, { userId: user.id, reason: 'account_disabled' });
      throw new AppError('ACCOUNT_DISABLED', 'Your account is disabled. Contact your administrator.');
    }

    const organizationId = await this.pickOrganization(user, dto.organizationId);

    if (user.mfaEnabled) {
      if (user.failedLoginCount > 0) await user.update({ failedLoginCount: 0 });
      await this.recordLogin('MFA_CHALLENGE', dto.email, meta, { userId: user.id, organizationId });
      return { result: { status: 'MFA_REQUIRED', challengeToken: this.tokens.signMfaChallenge({ sub: user.id, oid: organizationId }) } };
    }

    return this.completeLogin(user, organizationId, meta, false);
  }

  async verifyMfa(dto: MfaVerifyDto, meta: ClientMeta): Promise<AuthOutcome<LoginResult>> {
    const claims = this.tokens.verifyMfaChallenge(dto.challengeToken);
    const user = await withSecrets().findByPk(claims.sub);
    if (!user || user.status !== 'ACTIVE' || !user.mfaEnabled) throw new AppError('UNAUTHENTICATED', 'Invalid sign-in challenge');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked due to repeated failed sign-in attempts.');
    }

    const usingRecovery = !dto.code && !!dto.recoveryCode;
    const ok = dto.code
      ? await this.mfa.verifyAndConsume(user, dto.code)
      : await this.mfa.consumeRecoveryCode(user.id, dto.recoveryCode ?? '');
    if (!ok) {
      const policy = await this.policies.forUser(user.id);
      await this.registerFailure(user, policy.lockout, meta, 'invalid_mfa');
      throw new AppError('MFA_INVALID', 'Invalid verification code');
    }

    if (usingRecovery) {
      await this.audit.record({ action: 'auth.mfa_recovery_code_used', entityType: 'User', entityId: user.id, actorUserId: user.id, organizationId: null });
      await this.notifications.notify(user.id, { type: 'security', title: 'A recovery code was used to sign in', link: '/me/security' });
    }

    const organizationId = await this.pickOrganization(user, claims.oid ?? undefined);
    return this.completeLogin(user, organizationId, meta, true);
  }

  async refresh(rawToken: string | undefined): Promise<AuthOutcome<{ accessToken: string; expiresIn: number }>> {
    if (!rawToken) throw new AppError('UNAUTHENTICATED', 'No refresh token');
    const rotated = await this.sessions.rotate(rawToken, async (orgId) => (await this.policies.forOrganization(orgId)).session);
    const user = await User.findByPk(rotated.session.userId, { attributes: ['status'], rejectOnEmpty: true });
    if (user.status !== 'ACTIVE') {
      await this.sessions.revoke(rotated.session.id, 'account_disabled');
      throw new AppError('ACCOUNT_DISABLED', 'Your account is disabled');
    }
    const accessToken = this.tokens.signAccess({ sub: rotated.session.userId, sid: rotated.session.id, oid: rotated.session.organizationId });
    return {
      result: { accessToken, expiresIn: this.tokens.accessTtlSeconds },
      refresh: { token: rotated.refreshToken, expiresAt: rotated.refreshExpiresAt },
    };
  }

  /** Revokes the session identified by the refresh token (works even if the access token expired). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await RefreshToken.findOne({ where: { tokenHash: sha256(rawToken) }, include: [UserSession] });
    if (!record?.session || record.session.revokedAt) return;
    await this.sessions.revoke(record.sessionId, 'logout');
    await this.audit.record({
      action: 'auth.logout',
      entityType: 'UserSession',
      entityId: record.sessionId,
      actorUserId: record.session.userId,
      organizationId: record.session.organizationId,
    });
  }

  // ── Password recovery & invitations ─────────────────────────────────────

  async forgotPassword(email: string): Promise<void> {
    const user = await User.findOne({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const raw = generateToken();
    await this.db.transaction(async (transaction) => {
      await ActionToken.update({ usedAt: new Date() }, { where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null }, transaction });
      await ActionToken.create(
        {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: sha256(raw),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
        },
        { transaction },
      );
    });
    await this.audit.record({ action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, actorUserId: user.id, organizationId: null });

    const url = `${this.config.get('APP_URL')}/reset-password?token=${encodeURIComponent(raw)}`;
    try {
      await this.mail.send(passwordResetEmail(user.email, user.firstName, url, PASSWORD_RESET_TTL_MINUTES));
    } catch (e) {
      this.logger.error(`Failed to send password reset email to user ${user.id}`, (e as Error).stack);
    }
  }

  async inspectToken(token: string, purpose: ActionTokenPurpose) {
    const record = await this.findValidToken(token, purpose);
    const policy = await this.policies.forUser(record.userId);
    return {
      valid: true,
      email: record.user!.email,
      firstName: record.user!.firstName,
      lastName: record.user!.lastName,
      organizationName: record.organization?.name ?? null,
      existingAccount: !!record.user!.passwordHash,
      passwordPolicy: policy.password,
    };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const record = await this.findValidToken(token, 'PASSWORD_RESET');
    const user = record.user!;
    const policy = await this.policies.forUser(record.userId);
    await this.policies.assertAcceptable(password, policy.password, user);

    await this.db.transaction(async (transaction) => {
      await this.claimToken(record.id, transaction);
      await this.policies.setPassword(record.userId, password, policy.password.historyCount, transaction);
      await this.sessions.revokeAll(record.userId, 'password_reset', {}, transaction);
      await this.audit.record(
        { action: 'auth.password_reset', entityType: 'User', entityId: record.userId, actorUserId: record.userId, organizationId: null, summary: 'Password reset via email link; all sessions revoked' },
        transaction,
      );
    });
    await this.notifySecurity(user, 'Your password was reset');
  }

  async acceptInvitation(dto: AcceptInvitationDto): Promise<{ email: string }> {
    const record = await this.findValidToken(dto.token, 'INVITATION');
    const user = record.user!;
    if (!record.organizationId || !record.organization) throw new AppError('TOKEN_INVALID', 'This invitation is invalid');
    if (record.organization.status !== 'ACTIVE') throw new AppError('ORGANIZATION_INACTIVE', 'This organization is not active');

    const membership = await OrganizationMembership.findOne({ where: { organizationId: record.organizationId, userId: record.userId }, ...CROSS_TENANT });
    if (!membership || membership.status !== 'INVITED') throw new AppError('TOKEN_INVALID', 'This invitation is no longer valid');

    const existingAccount = !!user.passwordHash;
    const policy = await this.policies.forUser(record.userId);
    if (existingAccount) {
      if (!(await this.hasher.verify(user.passwordHash, dto.password))) {
        throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect');
      }
    } else {
      const names = { firstName: dto.firstName ?? user.firstName, lastName: dto.lastName ?? user.lastName };
      await this.policies.assertAcceptable(dto.password, policy.password, { id: user.id, email: user.email, ...names });
    }

    await this.db.transaction(async (transaction) => {
      await this.claimToken(record.id, transaction);
      if (!existingAccount) {
        await User.update(
          { ...(dto.firstName ? { firstName: dto.firstName } : {}), ...(dto.lastName ? { lastName: dto.lastName } : {}) },
          { where: { id: record.userId }, transaction },
        );
        await this.policies.setPassword(record.userId, dto.password, policy.password.historyCount, transaction);
      }
      await membership.update({ status: 'ACTIVE', joinedAt: new Date(), updatedById: record.userId }, { transaction, ...CROSS_TENANT });
      await this.audit.record(
        { action: 'user.invitation_accepted', entityType: 'OrganizationMembership', entityId: membership.id, actorUserId: record.userId, organizationId: record.organizationId },
        transaction,
      );
    });
    return { email: user.email };
  }

  // ── Organization self-registration ───────────────────────────────────────

  async registerOrganization(dto: RegisterOrganizationDto, meta: ClientMeta): Promise<AuthOutcome<LoginResult>> {
    if (!this.config.get('ALLOW_ORGANIZATION_SIGNUP')) throw AppError.forbidden('Organization sign-up is disabled');
    if (dto.organization.timezone && !isValidTimeZone(dto.organization.timezone)) {
      throw AppError.validation([{ field: 'organization.timezone', message: 'timezone must be a valid IANA time zone' }]);
    }
    if (await User.findOne({ where: { email: dto.admin.email }, attributes: ['id'] })) {
      throw AppError.conflict('An account with this email already exists. Sign in instead.');
    }
    const plan = await Plan.findOne({ where: { code: this.config.get('DEFAULT_PLAN_CODE') } });
    if (!plan || !plan.isActive) {
      this.logger.error(`Default plan "${this.config.get('DEFAULT_PLAN_CODE')}" is missing or inactive`);
      throw AppError.badRequest('Sign-up is temporarily unavailable');
    }
    await this.policies.assertAcceptable(dto.admin.password, DEFAULT_SECURITY_POLICY.password, dto.admin);

    const userId = await this.db.transaction(async (transaction) => {
      const created = await User.create({ email: dto.admin.email, firstName: dto.admin.firstName, lastName: dto.admin.lastName }, { transaction });
      const { organization, roleIdsByKey } = await this.provisioning.provision(transaction, {
        ...dto.organization,
        planId: plan.id,
        status: 'ACTIVE',
        createdById: created.id,
      });
      await this.policies.setPassword(created.id, dto.admin.password, DEFAULT_SECURITY_POLICY.password.historyCount, transaction);
      const membership = await OrganizationMembership.create(
        { organizationId: organization.id, userId: created.id, status: 'ACTIVE', joinedAt: new Date(), createdById: created.id, updatedById: created.id },
        { transaction, ...CROSS_TENANT },
      );
      await MembershipRole.create(
        { organizationId: organization.id, membershipId: membership.id, roleId: roleIdsByKey.get('org_admin')!, assignedById: created.id },
        { transaction, ...CROSS_TENANT },
      );
      await this.audit.record(
        { action: 'organization.registered', entityType: 'Organization', entityId: organization.id, actorUserId: created.id, organizationId: organization.id, summary: `Organization "${organization.name}" registered` },
        transaction,
      );
      return created.id;
    });

    const user = await withSecrets().findByPk(userId, { rejectOnEmpty: true });
    const organizationId = await this.pickOrganization(user);
    return this.completeLogin(user, organizationId, meta, false);
  }

  // ── Authenticated account operations ─────────────────────────────────────

  async context(auth: AuthContext): Promise<AccessContext> {
    return this.buildContext(auth.userId, auth.organizationId);
  }

  async updateProfile(auth: AuthContext, dto: UpdateProfileDto) {
    const user = await User.findByPk(auth.userId, { rejectOnEmpty: true });
    const before = user.get({ plain: true, clone: true });
    const data = {
      ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
      ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone === '' ? null : dto.phone } : {}),
    };
    await user.update({ ...data, updatedById: auth.userId });
    await this.audit.record({
      action: 'user.profile_updated',
      entityType: 'User',
      entityId: auth.userId,
      changes: diff(before, data, ['firstName', 'lastName', 'phone']),
    });
    return this.toAuthUser(user);
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto): Promise<void> {
    const user = await withSecrets().findByPk(auth.userId, { rejectOnEmpty: true });
    if (!(await this.hasher.verify(user.passwordHash, dto.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new AppError('PASSWORD_POLICY_VIOLATION', 'Password does not meet the security policy', [
        { field: 'newPassword', message: 'New password must differ from the current password' },
      ]);
    }
    const policy = await this.policies.forUser(user.id);
    await this.policies.assertAcceptable(dto.newPassword, policy.password, user);

    await this.db.transaction(async (transaction) => {
      await this.policies.setPassword(user.id, dto.newPassword, policy.password.historyCount, transaction);
      await this.sessions.revokeAll(user.id, 'password_changed', { exceptSessionId: auth.sessionId }, transaction);
      await this.audit.record({ action: 'auth.password_changed', entityType: 'User', entityId: user.id, summary: 'Password changed; other sessions revoked' }, transaction);
    });
    await this.notifySecurity(user, 'Your password was changed');
  }

  async switchOrganization(auth: AuthContext, organizationId: string): Promise<{ accessToken: string; expiresIn: number; context: AccessContext }> {
    await this.access.resolve(auth.userId, organizationId);
    const policy = await this.policies.forOrganization(organizationId);
    const session = await UserSession.findByPk(auth.sessionId, { rejectOnEmpty: true });
    const cap = new Date(session.createdAt.getTime() + policy.session.maxLifetimeHours * 3_600_000);

    await this.db.transaction(async (transaction) => {
      await session.update({ organizationId, expiresAt: cap < session.expiresAt ? cap : session.expiresAt }, { transaction });
      await User.update({ lastOrganizationId: organizationId }, { where: { id: auth.userId }, transaction });
    });
    await this.audit.record({ action: 'auth.organization_switched', entityType: 'UserSession', entityId: auth.sessionId, organizationId });

    return {
      accessToken: this.tokens.signAccess({ sub: auth.userId, sid: auth.sessionId, oid: organizationId }),
      expiresIn: this.tokens.accessTtlSeconds,
      context: await this.buildContext(auth.userId, organizationId),
    };
  }

  async listSessions(auth: AuthContext) {
    const rows = await this.sessions.listActive(auth.userId);
    return rows.map((s) => ({ ...s.get({ plain: true }), current: s.id === auth.sessionId }));
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    const session = await UserSession.findOne({ where: { id: sessionId, userId: auth.userId, revokedAt: null } });
    if (!session) throw AppError.notFound('Session');
    await this.sessions.revoke(session.id, 'revoked_by_user');
    await this.audit.record({ action: 'auth.session_revoked', entityType: 'UserSession', entityId: session.id });
  }

  async revokeOtherSessions(auth: AuthContext): Promise<number> {
    const count = await this.sessions.revokeAll(auth.userId, 'revoked_by_user', { exceptSessionId: auth.sessionId });
    await this.audit.record({ action: 'auth.other_sessions_revoked', entityType: 'User', entityId: auth.userId, metadata: { count } });
    return count;
  }

  /** The user's own sign-in history across all organizations. */
  async loginHistory(userId: string, query: PaginationQueryDto) {
    const { rows, count } = await LoginEvent.findAndCountAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      ...paginationArgs(query),
      attributes: ['id', 'outcome', 'failureReason', 'ipAddress', 'userAgent', 'createdAt'],
      include: [{ model: Organization, attributes: ['id', 'name'] }],
      ...CROSS_TENANT,
    });
    return new PaginatedResult(rows, paginationMeta(query, count));
  }

  async passwordPolicyFor(userId: string): Promise<PasswordPolicy> {
    return (await this.policies.forUser(userId)).password;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async completeLogin(user: User, organizationId: string | null, meta: ClientMeta, mfaVerified: boolean): Promise<AuthOutcome<LoginResult>> {
    const policy = await this.policies.forOrganization(organizationId);
    const created = await this.sessions.create({
      userId: user.id,
      organizationId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      mfaVerified,
      limits: policy.session,
    });
    await User.update(
      { lastLoginAt: new Date(), lastOrganizationId: organizationId ?? user.lastOrganizationId, failedLoginCount: 0, lockedUntil: null },
      { where: { id: user.id } },
    );
    await this.recordLogin('SUCCESS', user.email, meta, { userId: user.id, organizationId });

    return {
      result: {
        status: 'AUTHENTICATED',
        accessToken: this.tokens.signAccess({ sub: user.id, sid: created.session.id, oid: organizationId }),
        expiresIn: this.tokens.accessTtlSeconds,
        context: await this.buildContext(user.id, organizationId),
      },
      refresh: { token: created.refreshToken, expiresAt: created.refreshExpiresAt },
    };
  }

  /**
   * Chooses the organization for a new session. A requested organization is honoured only if the user
   * has an active membership in an active organization.
   */
  private async pickOrganization(user: User, requested?: string): Promise<string | null> {
    const memberships = await OrganizationMembership.findAll({
      where: { userId: user.id, status: 'ACTIVE' },
      order: [['joinedAt', 'ASC']],
      attributes: ['organizationId'],
      include: [{ model: Organization, attributes: ['status'] }],
      ...CROSS_TENANT,
    });
    const usable = memberships.filter((m) => m.organization?.status === 'ACTIVE').map((m) => m.organizationId);

    if (requested) {
      if (usable.includes(requested)) return requested;
      throw AppError.forbidden('You do not have access to the selected organization');
    }
    if (user.lastOrganizationId && usable.includes(user.lastOrganizationId)) return user.lastOrganizationId;
    if (usable.length) return usable[0];
    if (user.platformRole) return null;
    if (memberships.length) throw new AppError('ORGANIZATION_INACTIVE', 'Your organization is not active. Contact your administrator.');
    throw AppError.forbidden('Your account does not have access to any organization');
  }

  private async registerFailure(user: User, lockout: LockoutPolicy, meta: ClientMeta, reason: string): Promise<void> {
    const [, rows] = await User.update(
      { failedLoginCount: literal('failed_login_count + 1') },
      { where: { id: user.id }, returning: true },
    );
    const failedLoginCount = rows[0]?.failedLoginCount ?? user.failedLoginCount + 1;
    if (failedLoginCount < lockout.threshold) {
      await this.recordLogin('FAILURE', user.email, meta, { userId: user.id, reason });
      return;
    }
    await User.update(
      { failedLoginCount: 0, lockedUntil: new Date(Date.now() + lockout.durationMinutes * 60_000) },
      { where: { id: user.id } },
    );
    await this.recordLogin('LOCKED', user.email, meta, { userId: user.id, reason: 'too_many_attempts' });
    await this.audit.record({
      action: 'auth.account_locked',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      organizationId: null,
      summary: `Locked for ${lockout.durationMinutes} minutes after ${lockout.threshold} failed attempts`,
    });
    await this.notifySecurity(user, 'Your account was temporarily locked after repeated failed sign-in attempts');
  }

  private async recordLogin(
    outcome: LoginOutcome,
    email: string,
    meta: ClientMeta,
    extra: { userId?: string; organizationId?: string | null; reason?: string } = {},
  ): Promise<void> {
    await LoginEvent.create(
      {
        outcome,
        email: email.slice(0, 254),
        userId: extra.userId ?? null,
        organizationId: extra.organizationId ?? null,
        failureReason: extra.reason ?? null,
        ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
      CROSS_TENANT,
    );
  }

  private async findValidToken(raw: string, purpose: ActionTokenPurpose): Promise<ActionToken> {
    const record = await ActionToken.findOne({
      where: { tokenHash: sha256(raw) },
      include: [
        { model: withSecrets(), as: 'user' },
        { model: Organization, attributes: ['id', 'name', 'status'] },
      ],
    });
    if (!record?.user || record.purpose !== purpose || record.usedAt || record.expiresAt <= new Date() || record.user.status !== 'ACTIVE') {
      throw new AppError('TOKEN_INVALID', 'This link is invalid or has expired');
    }
    return record;
  }

  /** Single-use guarantee under concurrency. */
  private async claimToken(id: string, transaction: Transaction): Promise<void> {
    const [claimed] = await ActionToken.update({ usedAt: new Date() }, { where: { id, usedAt: null }, transaction });
    if (claimed !== 1) throw new AppError('TOKEN_INVALID', 'This link is invalid or has expired');
  }

  private async notifySecurity(user: Pick<User, 'id' | 'email' | 'firstName'>, event: string): Promise<void> {
    await this.notifications.notify(user.id, { type: 'security', title: event, link: '/me/security' });
    try {
      await this.mail.send(securityAlertEmail(user.email, user.firstName, event));
    } catch (e) {
      this.logger.error(`Failed to send security alert to user ${user.id}`, (e as Error).stack);
    }
  }

  private toAuthUser(user: User): AccessContext['user'] {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      platformRole: user.platformRole,
      mfaEnabled: user.mfaEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  private async buildContext(userId: string, organizationId: string | null): Promise<AccessContext> {
    const user = await User.findByPk(userId, { rejectOnEmpty: true });
    const memberships = await OrganizationMembership.findAll({
      where: { userId, status: 'ACTIVE' },
      attributes: ['id'],
      include: [{ model: Organization, where: { status: 'ACTIVE' }, attributes: ['id', 'name', 'slug', 'status', 'logoUrl'] }],
      order: [['organization', 'name', 'ASC']],
      ...CROSS_TENANT,
    });
    const organizations: OrganizationSummary[] = memberships.map((m) => {
      const o = m.organization!;
      return { id: o.id, name: o.name, slug: o.slug, status: o.status, logoUrl: o.logoUrl };
    });

    let resolved: Awaited<ReturnType<AccessService['resolve']>> | null = null;
    if (organizationId) {
      try {
        resolved = await this.access.resolve(userId, organizationId);
      } catch (e) {
        if (!user.platformRole) throw e;
      }
    }
    const policy = await this.policies.forOrganization(resolved ? organizationId : null);

    return {
      user: this.toAuthUser(user),
      activeOrganization: resolved ? (organizations.find((o) => o.id === organizationId) ?? null) : null,
      organizations,
      roles: resolved?.roles ?? [],
      permissions: Object.fromEntries(resolved?.permissions ?? []),
      platformPermissions: platformPermissionsFor(user.platformRole),
      features: [...(resolved?.features ?? [])],
      mfaSetupRequired: policy.mfaRequired && !user.mfaEnabled,
      passwordExpired: isPasswordExpired(user.passwordChangedAt, policy.password.maxAgeDays),
    };
  }
}
