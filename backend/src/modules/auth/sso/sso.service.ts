import { Injectable, Logger } from '@nestjs/common';
import { Op } from 'sequelize';
import type { AuthContext } from '../../../common/auth/auth-context';
import { AppError } from '../../../common/errors/app-error';
import { AppConfig } from '../../../config/app-config.service';
import { DatabaseService } from '../../../database/database.service';
import { MembershipRole, Organization, OrganizationMembership, OrganizationSsoConfig, Plan, Role, SsoLoginState, User } from '../../../database/models';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../../infrastructure/crypto/encryption.service';
import { AuthService, type ClientMeta } from '../auth.service';
import type { SsoConfigDto } from './sso.dto';
import { OidcClient, OidcError, pkce, randomToken, sha256Hex } from './oidc-client';

const CROSS_TENANT = { skipTenantScope: true } as const;
const STATE_TTL_MS = 10 * 60_000;
const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

/** Why an SSO sign-in failed, as a stable code for the sign-in page. */
export type SsoFailure = 'expired' | 'not_configured' | 'provider_error' | 'no_account' | 'domain_not_allowed' | 'account_disabled' | 'email_unverified' | 'seat_limit';

export class SsoSignInError extends Error {
  constructor(readonly reason: SsoFailure, message: string) {
    super(message);
  }
}

/**
 * Single sign-on with the organization's OpenID Connect provider (`organization.security.manage` configures it).
 * The sign-in uses the authorization-code flow with PKCE, a single-use state and a nonce; people are matched by
 * verified email to their membership (an invitation is accepted on the way), or — with auto-provisioning — get a
 * membership with the default role when their email domain is allowed. With SSO required, members can't sign in
 * with a password; organization admins keep theirs as a fallback.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  readonly oidc = new OidcClient();

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: EncryptionService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  get redirectUri(): string {
    return `${this.config.get('APP_URL').replace(/\/+$/, '')}/api/v1/auth/sso/callback`;
  }

  appUrl(path = '/'): string {
    return `${this.config.get('APP_URL').replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // ---- Configuration (organization admins) -------------------------------------------------------

  async view(auth: AuthContext) {
    const c = await OrganizationSsoConfig.findByPk(auth.organizationId!);
    const org = await Organization.findByPk(auth.organizationId!, { attributes: ['slug'] });
    return {
      enabled: c?.enabled ?? false,
      issuer: c?.issuer ?? null,
      clientId: c?.clientId ?? null,
      hasClientSecret: !!c?.clientSecretEncrypted,
      emailDomains: c?.emailDomains ?? [],
      required: c?.required ?? false,
      autoProvision: c?.autoProvision ?? false,
      defaultRoleKey: c?.defaultRoleKey ?? 'employee',
      buttonLabel: c?.buttonLabel ?? null,
      redirectUri: this.redirectUri,
      signInUrl: org ? this.appUrl(`/api/v1/auth/sso/start/${org.slug}`) : null,
      updatedAt: c?.updatedAt ?? null,
    };
  }

  async update(auth: AuthContext, dto: SsoConfigDto) {
    const orgId = auth.organizationId!;
    const issuer = dto.issuer.trim().replace(/\/+$/, '');
    const production = this.config.get('NODE_ENV') === 'production';
    if (!/^https:\/\//i.test(issuer) && (production || !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(issuer))) {
      throw AppError.validation([{ field: 'issuer', message: 'The issuer must be an https:// URL' }]);
    }
    const domains = [...new Set(dto.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    if (dto.enabled && !domains.length) throw AppError.validation([{ field: 'emailDomains', message: 'Add at least one email domain' }]);
    const taken = await OrganizationSsoConfig.findOne({ where: { organizationId: { [Op.ne]: orgId }, emailDomains: { [Op.overlap]: domains } }, attributes: ['emailDomains'], ...CROSS_TENANT });
    if (taken) {
      const clash = domains.filter((d) => taken.emailDomains.includes(d));
      throw AppError.validation([{ field: 'emailDomains', message: `${clash.join(', ')} already signs in to another organization` }]);
    }
    const role = await Role.findOne({ where: { key: dto.defaultRoleKey ?? 'employee' }, attributes: ['id', 'key'] });
    if (!role) throw AppError.validation([{ field: 'defaultRoleKey', message: 'Choose an existing role' }]);
    const existing = await OrganizationSsoConfig.findByPk(orgId);
    if (dto.enabled && !dto.clientSecret && !existing?.clientSecretEncrypted && !dto.publicClient) {
      throw AppError.validation([{ field: 'clientSecret', message: 'Enter the client secret from your identity provider' }]);
    }
    if (dto.enabled) {
      try {
        await this.oidc.discover(issuer, true);
      } catch (e) {
        throw AppError.validation([{ field: 'issuer', message: e instanceof Error ? e.message : 'The provider could not be reached' }]);
      }
    }
    const values = {
      enabled: dto.enabled,
      issuer,
      clientId: dto.clientId.trim(),
      ...(dto.clientSecret ? { clientSecretEncrypted: this.crypto.encrypt(dto.clientSecret, fields.ssoClientSecret(orgId)) } : dto.publicClient ? { clientSecretEncrypted: null } : {}),
      emailDomains: domains,
      required: dto.enabled && (dto.required ?? false),
      autoProvision: dto.autoProvision ?? false,
      defaultRoleKey: role.key,
      buttonLabel: dto.buttonLabel?.trim() || null,
      updatedById: auth.userId,
    };
    await this.db.transaction(async (transaction) => {
      if (existing) await existing.update(values, { transaction });
      else await OrganizationSsoConfig.create({ organizationId: orgId, ...values }, { transaction });
      await this.audit.record(
        {
          action: 'organization.sso_updated',
          entityType: 'Organization',
          entityId: orgId,
          summary: dto.enabled ? `Single sign-on ${existing?.enabled ? 'updated' : 'turned on'} (${issuer}${values.required ? ', required' : ''})` : 'Single sign-on turned off',
          metadata: { issuer, clientId: values.clientId, emailDomains: domains, required: values.required, autoProvision: values.autoProvision, secretChanged: !!dto.clientSecret },
        },
        transaction,
      );
    });
    return this.view(auth);
  }

  // ---- Sign-in (public) ---------------------------------------------------------------------------

  /** The organization that signs in with SSO for a work email, if any. */
  async discover(email: string) {
    const domain = domainOf(email);
    if (!domain) return null;
    const c = await OrganizationSsoConfig.findOne({ where: { enabled: true, emailDomains: { [Op.contains]: [domain] } }, attributes: ['organizationId', 'buttonLabel', 'required'], ...CROSS_TENANT });
    if (!c) return null;
    const org = await Organization.findOne({ where: { id: c.organizationId, status: 'ACTIVE' }, attributes: ['slug', 'name'] });
    return org ? { organizationSlug: org.slug, organizationName: org.name, buttonLabel: c.buttonLabel ?? `Continue with ${org.name} SSO`, required: c.required } : null;
  }

  /** The identity provider URL to send the browser to. */
  async start(slug: string, opts: { returnTo?: string; loginHint?: string }): Promise<string> {
    const org = await Organization.findOne({ where: { slug, status: 'ACTIVE' }, attributes: ['id'] });
    const c = org ? await OrganizationSsoConfig.findOne({ where: { organizationId: org.id, enabled: true }, ...CROSS_TENANT }) : null;
    if (!org || !c) throw new SsoSignInError('not_configured', 'Single sign-on is not set up for this organization');
    const discovery = await this.provider(c);
    const state = randomToken();
    const nonce = randomToken(24);
    const { verifier, challenge } = pkce();
    await SsoLoginState.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } });
    await SsoLoginState.create({ id: sha256Hex(state), organizationId: org.id, nonce, codeVerifier: verifier, returnTo: safeReturnTo(opts.returnTo), expiresAt: new Date(Date.now() + STATE_TTL_MS) });
    return this.oidc.authorizationUrl(discovery, { clientId: c.clientId, redirectUri: this.redirectUri, state, nonce, challenge, loginHint: opts.loginHint });
  }

  /** Finishes the sign-in when the provider sends the browser back; returns the session and where to go next. */
  async callback(params: { code?: string; state?: string; error?: string; errorDescription?: string }, meta: ClientMeta) {
    const stateRow = params.state ? await SsoLoginState.findByPk(sha256Hex(params.state)) : null;
    if (stateRow) await stateRow.destroy();
    if (!stateRow || stateRow.expiresAt < new Date()) throw new SsoSignInError('expired', 'This sign-in link has expired. Start again.');
    if (params.error) throw new SsoSignInError('provider_error', params.errorDescription ?? params.error);
    if (!params.code) throw new SsoSignInError('provider_error', 'The provider sent no authorization code');
    const c = await OrganizationSsoConfig.findOne({ where: { organizationId: stateRow.organizationId, enabled: true }, ...CROSS_TENANT });
    if (!c) throw new SsoSignInError('not_configured', 'Single sign-on is not set up for this organization');
    const discovery = await this.provider(c);
    let claims;
    try {
      const secret = c.clientSecretEncrypted ? this.crypto.decrypt(c.clientSecretEncrypted, fields.ssoClientSecret(c.organizationId)) : null;
      const idToken = await this.oidc.exchangeCode(discovery, { code: params.code, redirectUri: this.redirectUri, clientId: c.clientId, clientSecret: secret, verifier: stateRow.codeVerifier });
      claims = await this.oidc.verifyIdToken(idToken, discovery, { clientId: c.clientId, nonce: stateRow.nonce });
    } catch (e) {
      if (e instanceof OidcError) {
        this.logger.warn(`SSO sign-in failed for organization ${c.organizationId}: ${e.message}`);
        throw new SsoSignInError('provider_error', e.message);
      }
      throw e;
    }
    const email = (claims.email ?? '').trim().toLowerCase();
    if (!email) throw new SsoSignInError('provider_error', 'The provider did not share an email address');
    if (claims.email_verified === false || claims.email_verified === 'false') throw new SsoSignInError('email_unverified', 'Your email address is not verified with the identity provider');
    if (!c.emailDomains.includes(domainOf(email))) throw new SsoSignInError('domain_not_allowed', `${domainOf(email)} accounts can't sign in to this organization`);
    const userId = await this.memberFor(c, email, claims);
    const outcome = await this.auth.completeSsoLogin(userId, c.organizationId, meta);
    await this.audit.record({ action: 'auth.sso_login', entityType: 'User', entityId: userId, actorUserId: userId, organizationId: c.organizationId, summary: `Signed in with SSO (${email})` });
    return { ...outcome, returnTo: stateRow.returnTo ?? '/' };
  }

  // ---- internals ---------------------------------------------------------------------------------

  private async provider(c: OrganizationSsoConfig) {
    try {
      return await this.oidc.discover(c.issuer);
    } catch (e) {
      throw new SsoSignInError('provider_error', e instanceof Error ? e.message : 'The identity provider could not be reached');
    }
  }

  /** The member's user id; accepts a pending invitation, or creates the membership when auto-provisioning. */
  private async memberFor(c: OrganizationSsoConfig, email: string, claims: { given_name?: string; family_name?: string; name?: string }): Promise<string> {
    const orgId = c.organizationId;
    const user = await User.findOne({ where: { email } });
    if (user && user.status !== 'ACTIVE') throw new SsoSignInError('account_disabled', 'Your account is disabled. Contact your administrator.');
    const membership = user ? await OrganizationMembership.findOne({ where: { userId: user.id, organizationId: orgId }, ...CROSS_TENANT }) : null;
    if (membership?.status === 'ACTIVE') return user!.id;
    if (membership?.status === 'INVITED') {
      await membership.update({ status: 'ACTIVE', joinedAt: new Date() }, CROSS_TENANT);
      return user!.id;
    }
    if (membership) throw new SsoSignInError('account_disabled', 'Your access to this organization is suspended');
    if (!c.autoProvision) throw new SsoSignInError('no_account', 'You are not a member of this organization yet. Ask your HR team for an invitation.');
    const org = await Organization.findByPk(orgId, { attributes: ['id'], include: [{ model: Plan, attributes: ['maxUsers'] }] });
    const maxUsers = org?.plan?.maxUsers;
    if (maxUsers && (await OrganizationMembership.count({ where: { organizationId: orgId, status: ['ACTIVE', 'INVITED'] }, ...CROSS_TENANT })) >= maxUsers) {
      throw new SsoSignInError('seat_limit', 'Your organization has no free seats. Contact your administrator.');
    }
    const role = await Role.findOne({ where: { organizationId: orgId, key: c.defaultRoleKey }, attributes: ['id'], ...CROSS_TENANT });
    if (!role) throw new SsoSignInError('not_configured', 'The default role for new members no longer exists');
    const [first, ...rest] = (claims.name ?? '').trim().split(/\s+/);
    const firstName = (claims.given_name ?? first ?? '').trim() || email.split('@')[0]!;
    const lastName = (claims.family_name ?? rest.join(' ')).trim() || '-';
    return this.db.transaction(async (transaction) => {
      const u = user ?? (await User.create({ email, firstName: firstName.slice(0, 100), lastName: lastName.slice(0, 100) }, { transaction }));
      const m = await OrganizationMembership.create({ organizationId: orgId, userId: u.id, status: 'ACTIVE', joinedAt: new Date() }, { transaction, ...CROSS_TENANT });
      await MembershipRole.create({ organizationId: orgId, membershipId: m.id, roleId: role.id }, { transaction, ...CROSS_TENANT });
      await this.audit.record({ action: 'user.sso_provisioned', entityType: 'OrganizationMembership', entityId: m.id, actorUserId: u.id, organizationId: orgId, summary: `${email} joined through single sign-on` }, transaction);
      return u.id;
    });
  }
}

/** Only paths inside the app (never another site). */
function safeReturnTo(value: string | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.length > 300) return null;
  return value;
}
