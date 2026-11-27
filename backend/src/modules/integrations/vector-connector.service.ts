import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import type { AuthContext } from '../../common/auth/auth-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../database/database.service';
import {
  MembershipRole,
  OrganizationMembership,
  OrganizationVectorConnector,
  Permission,
  Role,
  RolePermission,
  User,
} from '../../database/models';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { ctx as fields } from '../../infrastructure/crypto/encrypted-fields';
import { EncryptionService } from '../../infrastructure/crypto/encryption.service';
import type { VectorConnectDto, VectorConnectorDto } from './integrations.dto';

const PK_PREFIX = 'pk_live_';
const SK_PREFIX = 'sk_live_';

type VectorConnectResponse = {
  embedUrl: string;
  organization?: { id: string; name: string; slug: string };
  user?: { id: string; name: string; email: string; role: string };
};

/**
 * Partner side of Vector's workspace embed: org admins store keys and choose which roles may open Vector;
 * those people sign in with their own Vector email/password.
 */
@Injectable()
export class VectorConnectorService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: EncryptionService,
    private readonly audit: AuditService,
  ) {}

  async view(auth: AuthContext) {
    const row = await OrganizationVectorConnector.findByPk(auth.organizationId!);
    if (!row) {
      return {
        configured: false,
        enabled: false,
        apiBaseUrl: null as string | null,
        appOrigin: null as string | null,
        publishableKey: null as string | null,
        hasSecretKey: false,
        secretPrefix: null as string | null,
        allowedRoleIds: [] as string[],
        deniedUserIds: [] as string[],
        vectorOrgName: null as string | null,
        vectorOrgSlug: null as string | null,
        lastConnectedAt: null as string | null,
        updatedAt: null as string | null,
      };
    }
    return this.toView(row);
  }

  /** Lightweight check for the sidebar: may this person open Vector? */
  async status(auth: AuthContext) {
    const row = await OrganizationVectorConnector.findByPk(auth.organizationId!);
    const available =
      !!row && row.enabled && this.userMayOpen(auth, row.allowedRoleIds ?? [], row.deniedUserIds ?? []);
    return {
      available,
      configured: !!row,
      enabled: row?.enabled ?? false,
      vectorOrgName: row?.vectorOrgName ?? null,
    };
  }

  /** People who currently have Vector access (and those blocked individually). */
  async listAccess(auth: AuthContext) {
    const orgId = auth.organizationId!;
    const row = await OrganizationVectorConnector.findByPk(orgId);
    if (!row) return { people: [] as VectorAccessPerson[], denied: [] as VectorAccessPerson[] };

    const allowedRoleIds = row.allowedRoleIds ?? [];
    const deniedUserIds = new Set(row.deniedUserIds ?? []);
    const byUser = new Map<string, VectorAccessPerson>();

    if (allowedRoleIds.length) {
      const holders = await MembershipRole.findAll({
        where: { organizationId: orgId, roleId: { [Op.in]: allowedRoleIds } },
        attributes: ['membershipId', 'roleId'],
        include: [{ model: Role, attributes: ['id', 'name'] }],
      });
      const membershipIds = [...new Set(holders.map((h) => h.membershipId))];
      const memberships = membershipIds.length
        ? await OrganizationMembership.findAll({
            where: { id: { [Op.in]: membershipIds }, organizationId: orgId, status: 'ACTIVE' },
            include: [{ model: User, attributes: ['id', 'email', 'firstName', 'lastName', 'avatarUrl', 'status'] }],
          })
        : [];
      const roleNameByMembership = new Map<string, string[]>();
      for (const h of holders) {
        const name = h.role?.name;
        if (!name) continue;
        const list = roleNameByMembership.get(h.membershipId) ?? [];
        if (!list.includes(name)) list.push(name);
        roleNameByMembership.set(h.membershipId, list);
      }
      for (const m of memberships) {
        const user = m.user;
        if (!user || user.status === 'DISABLED') continue;
        byUser.set(user.id, {
          userId: user.id,
          membershipId: m.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl,
          via: 'role',
          roleNames: roleNameByMembership.get(m.id) ?? [],
          removable: true,
        });
      }
    }

    const adminUserIds = await this.integrationAdminUserIds(orgId);
    if (adminUserIds.length) {
      const memberships = await OrganizationMembership.findAll({
        where: { organizationId: orgId, userId: { [Op.in]: adminUserIds }, status: 'ACTIVE' },
        include: [{ model: User, attributes: ['id', 'email', 'firstName', 'lastName', 'avatarUrl', 'status'] }],
      });
      for (const m of memberships) {
        const user = m.user;
        if (!user || user.status === 'DISABLED') continue;
        const existing = byUser.get(user.id);
        if (existing) {
          existing.via = 'both';
          existing.removable = false;
          if (!existing.roleNames.includes('Integrations admin')) existing.roleNames = [...existing.roleNames, 'Integrations admin'];
        } else {
          byUser.set(user.id, {
            userId: user.id,
            membershipId: m.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            avatarUrl: user.avatarUrl,
            via: 'admin',
            roleNames: ['Integrations admin'],
            removable: false,
          });
        }
      }
    }

    const people: VectorAccessPerson[] = [];
    const denied: VectorAccessPerson[] = [];
    for (const person of byUser.values()) {
      if (deniedUserIds.has(person.userId)) {
        denied.push({ ...person, removable: true });
      } else {
        people.push(person);
      }
    }
    people.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    denied.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
    return { people, denied };
  }

  async denyAccess(auth: AuthContext, userId: string) {
    const orgId = auth.organizationId!;
    const row = await OrganizationVectorConnector.findByPk(orgId);
    if (!row) throw AppError.badRequest('Vector is not connected for this organization');

    const membership = await OrganizationMembership.findOne({
      where: { organizationId: orgId, userId, status: 'ACTIVE' },
      include: [{ model: User, attributes: ['id', 'email', 'firstName', 'lastName'] }],
    });
    if (!membership?.user) throw AppError.notFound('User');

    const admins = await this.integrationAdminUserIds(orgId);
    if (admins.includes(userId)) {
      throw AppError.badRequest('This person opens Vector as an integrations admin. Change their roles instead of removing them here.');
    }

    const deniedUserIds = [...new Set([...(row.deniedUserIds ?? []), userId])];
    await row.update({ deniedUserIds, updatedById: auth.userId });
    await this.audit.record({
      action: 'integration.vector_access_denied',
      entityType: 'User',
      entityId: userId,
      summary: `Removed Vector access for ${membership.user.email}`,
      metadata: { email: membership.user.email },
    });
    return this.listAccess(auth);
  }

  async restoreAccess(auth: AuthContext, userId: string) {
    const orgId = auth.organizationId!;
    const row = await OrganizationVectorConnector.findByPk(orgId);
    if (!row) throw AppError.badRequest('Vector is not connected for this organization');

    const deniedUserIds = (row.deniedUserIds ?? []).filter((id) => id !== userId);
    await row.update({ deniedUserIds, updatedById: auth.userId });
    await this.audit.record({
      action: 'integration.vector_access_restored',
      entityType: 'User',
      entityId: userId,
      summary: `Restored Vector access for user ${userId}`,
      metadata: { userId },
    });
    return this.listAccess(auth);
  }

  async upsert(auth: AuthContext, dto: VectorConnectorDto) {
    const orgId = auth.organizationId!;
    const apiBaseUrl = normalizeApiBase(dto.apiBaseUrl);
    const appOrigin = dto.appOrigin != null ? normalizeOrigin(dto.appOrigin) : null;
    const publishableKey = dto.publishableKey.trim();
    if (!publishableKey.startsWith(PK_PREFIX) || publishableKey.length < 16) {
      throw AppError.validation([{ field: 'publishableKey', message: 'Paste the publishable key from Vector (starts with pk_live_)' }]);
    }

    const existing = await OrganizationVectorConnector.findByPk(orgId);
    const secretKey = dto.secretKey?.trim() || null;
    if (secretKey) {
      if (!secretKey.startsWith(SK_PREFIX) || secretKey.length < 24) {
        throw AppError.validation([{ field: 'secretKey', message: 'Paste the secret key from Vector (starts with sk_live_)' }]);
      }
    } else if (!existing?.secretKeyEncrypted) {
      throw AppError.validation([{ field: 'secretKey', message: 'Paste the secret key shown once when you created the embed app in Vector' }]);
    }

    const allowedRoleIds = await this.resolveAllowedRoles(orgId, dto.allowedRoleIds ?? existing?.allowedRoleIds ?? []);
    await this.probePublic(apiBaseUrl, publishableKey);

    const values = {
      apiBaseUrl,
      appOrigin,
      publishableKey,
      enabled: dto.enabled ?? true,
      allowedRoleIds,
      updatedById: auth.userId,
      ...(secretKey
        ? {
            secretKeyEncrypted: this.crypto.encrypt(secretKey, fields.vectorSecretKey(orgId)),
            secretPrefix: secretKey.slice(0, 14),
          }
        : {}),
    };

    await this.db.transaction(async (transaction) => {
      if (existing) await existing.update(values, { transaction });
      else {
        await OrganizationVectorConnector.create(
          {
            organizationId: orgId,
            apiBaseUrl: values.apiBaseUrl,
            appOrigin: values.appOrigin,
            publishableKey: values.publishableKey,
            secretKeyEncrypted: values.secretKeyEncrypted!,
            secretPrefix: values.secretPrefix!,
            enabled: values.enabled,
            allowedRoleIds: values.allowedRoleIds,
            updatedById: auth.userId,
          },
          { transaction },
        );
      }
      await this.audit.record(
        {
          action: 'integration.vector_updated',
          entityType: 'Organization',
          entityId: orgId,
          summary: `Vector workspace connector ${existing ? 'updated' : 'connected'} (${publishableKey.slice(0, 14)}…)`,
          metadata: { apiBaseUrl, appOrigin, publishableKey, secretChanged: !!secretKey, enabled: values.enabled, allowedRoleIds },
        },
        transaction,
      );
    });

    return this.view(auth);
  }

  async remove(auth: AuthContext) {
    const orgId = auth.organizationId!;
    const row = await OrganizationVectorConnector.findByPk(orgId);
    if (!row) return { deleted: true };
    await this.db.transaction(async (transaction) => {
      await row.destroy({ transaction });
      await this.audit.record(
        {
          action: 'integration.vector_removed',
          entityType: 'Organization',
          entityId: orgId,
          summary: 'Vector workspace connector removed',
          metadata: { publishableKey: row.publishableKey },
        },
        transaction,
      );
    });
    return { deleted: true };
  }

  /** Opens Vector using stored keys + the caller's Vector email/password. */
  async connect(auth: AuthContext, dto: VectorConnectDto) {
    const row = await OrganizationVectorConnector.findByPk(auth.organizationId!);
    if (!row?.enabled) throw AppError.badRequest('Vector is not connected for this organization');
    if (!this.userMayOpen(auth, row.allowedRoleIds ?? [], row.deniedUserIds ?? [])) {
      throw AppError.forbidden('Your role is not allowed to open Vector. Ask an administrator.');
    }
    const secretKey = this.crypto.decrypt(row.secretKeyEncrypted, fields.vectorSecretKey(row.organizationId));

    let data: VectorConnectResponse;
    try {
      const res = await fetch(`${row.apiBaseUrl}/embed/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: dto.email.trim().toLowerCase(),
          password: dto.password,
          publishableKey: row.publishableKey,
          secretKey,
          path: dto.path?.trim() || null,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
        embedUrl?: string;
        organization?: VectorConnectResponse['organization'];
        user?: VectorConnectResponse['user'];
      } | null;
      if (!res.ok) {
        const message = body?.message || body?.error || `Vector returned HTTP ${res.status}`;
        if (res.status === 401) throw AppError.validation([{ field: 'password', message: message }]);
        if (res.status === 403 || res.status === 400) throw AppError.badRequest(message);
        throw new AppError('UPSTREAM_UNAVAILABLE', message);
      }
      if (!body?.embedUrl) throw new AppError('UPSTREAM_UNAVAILABLE', 'Vector did not return an embed URL');
      data = { embedUrl: body.embedUrl, organization: body.organization, user: body.user };
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('UPSTREAM_UNAVAILABLE', 'Could not reach Vector. Check the API base URL and that Vector is running.');
    }

    await row.update({
      vectorOrgName: data.organization?.name ?? row.vectorOrgName,
      vectorOrgSlug: data.organization?.slug ?? row.vectorOrgSlug,
      lastConnectedAt: new Date(),
      updatedById: auth.userId,
    });
    await this.audit.record({
      action: 'integration.vector_connected',
      entityType: 'Organization',
      entityId: auth.organizationId!,
      summary: `Opened Vector workspace${data.organization?.name ? ` (${data.organization.name})` : ''} as ${dto.email.trim().toLowerCase()}`,
      metadata: { publishableKey: row.publishableKey, vectorOrgSlug: data.organization?.slug ?? null },
    });

    return {
      embedUrl: rewriteEmbedOrigin(data.embedUrl, row.appOrigin),
      organization: data.organization ?? null,
      user: data.user ?? null,
    };
  }

  userMayOpen(auth: AuthContext, allowedRoleIds: string[], deniedUserIds: string[] = []): boolean {
    if (auth.permissions.has('integration.manage')) return true;
    if (deniedUserIds.includes(auth.userId)) return false;
    if (!allowedRoleIds.length) return false;
    return auth.roleIds.some((id) => allowedRoleIds.includes(id));
  }

  private async integrationAdminUserIds(orgId: string): Promise<string[]> {
    const permission = await Permission.findOne({ where: { key: 'integration.manage' }, attributes: ['id'] });
    if (!permission) return [];
    const rolePerms = await RolePermission.findAll({
      where: { organizationId: orgId, permissionId: permission.id },
      attributes: ['roleId'],
    });
    const roleIds = rolePerms.map((r) => r.roleId);
    if (!roleIds.length) return [];
    const holders = await MembershipRole.findAll({
      where: { organizationId: orgId, roleId: { [Op.in]: roleIds } },
      attributes: ['membershipId'],
    });
    const membershipIds = [...new Set(holders.map((h) => h.membershipId))];
    if (!membershipIds.length) return [];
    const memberships = await OrganizationMembership.findAll({
      where: { id: { [Op.in]: membershipIds }, organizationId: orgId, status: 'ACTIVE' },
      attributes: ['userId'],
    });
    return [...new Set(memberships.map((m) => m.userId))];
  }

  private async resolveAllowedRoles(orgId: string, roleIds: string[]): Promise<string[]> {
    const unique = [...new Set(roleIds.filter(Boolean))];
    if (!unique.length) return [];
    const found = await Role.findAll({
      where: { id: { [Op.in]: unique }, organizationId: orgId },
      attributes: ['id'],
    });
    if (found.length !== unique.length) {
      throw AppError.validation([{ field: 'allowedRoleIds', message: 'Choose roles that belong to this organization' }]);
    }
    return unique;
  }

  private toView(row: OrganizationVectorConnector) {
    return {
      configured: true,
      enabled: row.enabled,
      apiBaseUrl: row.apiBaseUrl,
      appOrigin: row.appOrigin,
      publishableKey: row.publishableKey,
      hasSecretKey: !!row.secretKeyEncrypted,
      secretPrefix: row.secretPrefix,
      allowedRoleIds: row.allowedRoleIds ?? [],
      deniedUserIds: row.deniedUserIds ?? [],
      vectorOrgName: row.vectorOrgName,
      vectorOrgSlug: row.vectorOrgSlug,
      lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }

  private async probePublic(apiBaseUrl: string, publishableKey: string) {
    try {
      const res = await fetch(`${apiBaseUrl}/embed/apps/${encodeURIComponent(publishableKey)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404) {
        throw AppError.validation([{ field: 'publishableKey', message: 'Vector does not recognise this publishable key' }]);
      }
      if (!res.ok) {
        throw new AppError('UPSTREAM_UNAVAILABLE', `Vector returned HTTP ${res.status} while checking the key`);
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw AppError.validation([{ field: 'apiBaseUrl', message: 'Could not reach Vector at this API base URL' }]);
    }
  }
}

type VectorAccessPerson = {
  userId: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  via: 'role' | 'admin' | 'both';
  roleNames: string[];
  removable: boolean;
};

function normalizeApiBase(url: string): string {
  let trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw AppError.validation([{ field: 'apiBaseUrl', message: 'Use an http:// or https:// URL' }]);
  }
  if (!/\/api$/i.test(trimmed)) trimmed = `${trimmed}/api`;
  return trimmed;
}

function normalizeOrigin(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw AppError.validation([{ field: 'appOrigin', message: 'Use an http:// or https:// URL' }]);
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    throw AppError.validation([{ field: 'appOrigin', message: 'Enter a valid Vector UI origin' }]);
  }
}

function rewriteEmbedOrigin(embedUrl: string, appOrigin: string | null | undefined): string {
  if (!appOrigin) return embedUrl;
  try {
    const embed = new URL(embedUrl);
    const origin = new URL(appOrigin);
    embed.protocol = origin.protocol;
    embed.host = origin.host;
    return embed.toString();
  } catch {
    return embedUrl;
  }
}
