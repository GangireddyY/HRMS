import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleKey, PermissionScope, type DelegatedGrant } from '../../../contracts';
import type { Request } from 'express';
import type { AuthContext } from '../../../common/auth/auth-context';
import { ALLOW_RESTRICTED_SESSION_KEY, IS_PUBLIC_KEY, STEP_UP_KEY, STEP_UP_MINUTES } from '../../../common/auth/decorators';
import { RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { User, UserSession } from '../../../database/models';
import { AccessService } from '../../rbac/access.service';
import { API_KEY_PREFIX, ApiKeyAuthenticator } from '../api-key-authenticator';
import { SecurityPolicyService, isPasswordExpired } from '../security-policy.service';
import { SessionService } from '../session.service';
import { TokenService } from '../token.service';

/**
 * Global authentication guard.
 * 1. Verifies the bearer access token.
 * 2. Verifies the session is live (not revoked/expired) – revocation is effective immediately.
 * 3. Re-validates organization membership and resolves permissions for the session's organization.
 * 4. Blocks restricted sessions (MFA enrollment required / password expired) except on allowed routes.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly sessions: SessionService,
    private readonly policies: SecurityPolicyService,
    private readonly apiKeys: ApiKeyAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (header.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
      if (this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, targets)) throw AppError.forbidden('This export is not available with an API key');
      req.auth = await this.apiKeys.authenticate(header.slice(7), req);
      RequestContext.set({ userId: req.auth.userId, organizationId: req.auth.organizationId ?? undefined });
      return true;
    }
    const claims = this.tokens.verifyAccess(header.slice(7));

    const session = await UserSession.findByPk(claims.sid, {
      include: [{ model: User, attributes: ['id', 'email', 'status', 'platformRole', 'mfaEnabled', 'passwordChangedAt'] }],
    });
    const now = new Date();
    if (!session?.user || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= now) {
      throw new AppError('SESSION_REVOKED', 'Session is no longer valid. Please sign in again.');
    }
    if (session.user.status !== 'ACTIVE') throw new AppError('ACCOUNT_DISABLED', 'Your account is disabled');
    if (claims.oid !== session.organizationId) {
      throw new AppError('SESSION_REVOKED', 'Organization context changed. Please refresh your session.');
    }

    let organizationId: string | null = null;
    let membershipId: string | null = null;
    let roleIds: string[] = [];
    let permissions = new Map<string, PermissionScope>();
    let features = new Set<ModuleKey>();
    let delegated: DelegatedGrant[] = [];

    if (session.organizationId) {
      try {
        const resolved = await this.access.resolve(session.userId, session.organizationId);
        organizationId = resolved.organizationId;
        membershipId = resolved.membershipId;
        roleIds = resolved.roles.map((r) => r.id);
        permissions = resolved.permissions;
        features = resolved.features;
        delegated = resolved.delegated;
      } catch (e) {
        // Platform admins keep platform access even if the organization becomes unavailable.
        if (!session.user.platformRole) throw e;
      }
    }

    const policy = await this.policies.forOrganization(organizationId);
    const auth: AuthContext = {
      userId: session.userId,
      sessionId: session.id,
      email: session.user.email,
      platformRole: session.user.platformRole,
      organizationId,
      membershipId,
      roleIds,
      permissions,
      delegated,
      features,
      mfaSetupRequired: this.policies.mfaRequiredFor(policy, session.user) && !session.user.mfaEnabled,
      passwordExpired: isPasswordExpired(session.user.passwordChangedAt, policy.password.maxAgeDays, now),
    };

    req.auth = auth;
    RequestContext.set({ userId: auth.userId, organizationId: auth.organizationId ?? undefined });

    this.sessions.touch(session).catch((e: unknown) => this.logger.error('Failed to update session activity', e as Error));

    if (!this.reflector.getAllAndOverride<boolean>(ALLOW_RESTRICTED_SESSION_KEY, targets)) {
      if (auth.passwordExpired) throw new AppError('PASSWORD_EXPIRED', 'Your password has expired. Please change it to continue.');
      if (auth.mfaSetupRequired) {
        throw new AppError('MFA_SETUP_REQUIRED', auth.platformRole && !policy.mfaRequired ? 'Platform administrators must use two-factor authentication. Set it up to continue.' : 'Your organization requires two-factor authentication. Set it up to continue.');
      }
    }
    if (this.reflector.getAllAndOverride<boolean>(STEP_UP_KEY, targets)) {
      const fresh = session.stepUpAt && now.getTime() - session.stepUpAt.getTime() < STEP_UP_MINUTES * 60_000;
      if (!fresh) throw new AppError('STEP_UP_REQUIRED', session.user.mfaEnabled ? 'Enter a code from your authenticator app to continue.' : 'Enter your password to continue.');
    }
    return true;
  }
}
