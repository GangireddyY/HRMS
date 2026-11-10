import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Op } from 'sequelize';
import { API_KEY_MAX_PER_ORG, API_KEY_PERMISSION_PATTERN, PERMISSIONS } from '../../contracts';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { DatabaseService } from '../../database/database.service';
import { ApiKey, User } from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { API_KEY_PREFIX } from '../auth/api-key-authenticator';
import type { ApiKeyDto } from './integrations.dto';

const DESCRIPTIONS = new Map(PERMISSIONS.map((p) => [p.key, p.description]));

/**
 * Read-only API keys (`integration.manage`). The full key is shown once; only its SHA-256 is kept. A key can only
 * carry view permissions its creator holds, acts for its creator, and stops working when revoked or expired.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** View permissions the caller could give a key. */
  grantable(auth: AuthContext) {
    return [...auth.permissions.keys()]
      .filter((p) => API_KEY_PERMISSION_PATTERN.test(p))
      .sort()
      .map((key) => ({ key, description: DESCRIPTIONS.get(key) ?? key, scope: auth.permissions.get(key)! }));
  }

  async list() {
    const keys = await ApiKey.findAll({ attributes: { exclude: ['keyHash'] }, order: [['createdAt', 'DESC']] });
    const users = new Map((await User.findAll({ where: { id: [...new Set(keys.flatMap((k) => [k.createdById, k.revokedById].filter((x): x is string => !!x)))] }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, fullName(u)]));
    return keys.map((k) => this.present(k, users));
  }

  async create(auth: AuthContext, dto: ApiKeyDto) {
    const invalid = dto.permissions.filter((p) => !API_KEY_PERMISSION_PATTERN.test(p) || !auth.permissions.has(p));
    if (invalid.length) throw AppError.validation([{ field: 'permissions', message: `A key can only have view permissions you hold (not ${invalid.join(', ')})` }]);
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) throw AppError.validation([{ field: 'expiresAt', message: 'The expiry must be in the future' }]);
    const active = await ApiKey.count({ where: { revokedAt: null, [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }] } });
    if (active >= API_KEY_MAX_PER_ORG) throw AppError.conflict(`An organization can have up to ${API_KEY_MAX_PER_ORG} active API keys; revoke one first`);
    const raw = `${API_KEY_PREFIX}${randomBytes(30).toString('base64url')}`;
    const key = await this.db.transaction(async (transaction) => {
      const k = await ApiKey.create(
        { organizationId: auth.organizationId!, name: dto.name, prefix: raw.slice(0, 13), keyHash: createHash('sha256').update(raw).digest('hex'), permissions: dto.permissions, createdById: auth.userId, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null },
        { transaction },
      );
      await this.audit.record({ action: 'integration.api_key_created', entityType: 'ApiKey', entityId: k.id, summary: `API key "${dto.name}" created (${k.prefix}…)`, metadata: { permissions: dto.permissions, expiresAt: dto.expiresAt ?? null } }, transaction);
      return k;
    });
    const creator = await User.findByPk(auth.userId, { attributes: ['firstName', 'lastName'] });
    return { ...this.present(key, new Map(creator ? [[auth.userId, fullName(creator)]] : [])), key: raw };
  }

  async revoke(auth: AuthContext, id: string) {
    const key = await ApiKey.findByPk(id);
    if (!key) throw AppError.notFound('API key');
    if (key.revokedAt) throw AppError.conflict('This key is already revoked');
    await this.db.transaction(async (transaction) => {
      await key.update({ revokedAt: new Date(), revokedById: auth.userId }, { transaction });
      await this.audit.record({ action: 'integration.api_key_revoked', entityType: 'ApiKey', entityId: id, summary: `API key "${key.name}" revoked (${key.prefix}…)` }, transaction);
    });
    return { revoked: true };
  }

  private present(k: ApiKey, users: Map<string, string>) {
    const now = new Date();
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      permissions: k.permissions,
      status: k.revokedAt ? 'REVOKED' : k.expiresAt && k.expiresAt <= now ? 'EXPIRED' : 'ACTIVE',
      createdBy: users.get(k.createdById) ?? null,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      lastUsedIp: k.lastUsedIp,
      expiresAt: k.expiresAt,
      revokedAt: k.revokedAt,
      revokedBy: k.revokedById ? (users.get(k.revokedById) ?? null) : null,
    };
  }
}
