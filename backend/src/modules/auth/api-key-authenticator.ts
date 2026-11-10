import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { PermissionScope } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { ApiKey, Organization } from '../../database/models';
import { AccessService } from '../rbac/access.service';

export const API_KEY_PREFIX = 'hrms_';
const READ_METHODS = new Set(['GET', 'HEAD']);
const TOUCH_EVERY_MS = 60_000;

/**
 * Authenticates `Authorization: Bearer hrms_…` API keys. A key acts for the person who created it, limited to the
 * permissions chosen for the key and to what that person still holds (losing access, or leaving, disables the key).
 * Keys are read-only (GET), and never pass a step-up.
 */
@Injectable()
export class ApiKeyAuthenticator {
  private readonly logger = new Logger(ApiKeyAuthenticator.name);

  constructor(private readonly access: AccessService) {}

  async authenticate(raw: string, req: Request): Promise<AuthContext> {
    const key = await ApiKey.findOne({ where: { keyHash: createHash('sha256').update(raw).digest('hex') }, skipTenantScope: true });
    const now = new Date();
    if (!key || key.revokedAt || (key.expiresAt && key.expiresAt <= now)) throw new AppError('UNAUTHENTICATED', 'The API key is invalid, expired or revoked');
    if (!READ_METHODS.has(req.method)) throw AppError.forbidden('API keys are read-only');
    const org = await Organization.findByPk(key.organizationId, { attributes: ['status'] });
    if (org?.status !== 'ACTIVE') throw new AppError('ORGANIZATION_INACTIVE', 'The organization is not active');
    let resolved;
    try {
      resolved = await this.access.resolve(key.createdById, key.organizationId);
    } catch {
      throw new AppError('UNAUTHENTICATED', "The API key's owner no longer has access to the organization");
    }
    const permissions = new Map<string, PermissionScope>();
    for (const p of key.permissions) {
      const scope = resolved.permissions.get(p);
      if (scope) permissions.set(p, scope);
    }
    if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
      ApiKey.update({ lastUsedAt: now, lastUsedIp: req.ip?.slice(0, 64) ?? null }, { where: { id: key.id }, skipTenantScope: true }).catch((e: unknown) => this.logger.warn(`Could not record API key use: ${(e as Error).message}`));
    }
    return {
      userId: key.createdById,
      sessionId: `api-key:${key.id}`,
      email: `${key.prefix}…`,
      platformRole: null,
      organizationId: key.organizationId,
      membershipId: resolved.membershipId,
      roleIds: [],
      permissions,
      delegated: [],
      features: resolved.features,
      mfaSetupRequired: false,
      passwordExpired: false,
    };
  }
}
