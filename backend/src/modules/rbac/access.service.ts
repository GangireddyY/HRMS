import { Injectable } from '@nestjs/common';
import { MODULES, ModuleKey, PermissionScope, getPermission, maxScope } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import {
  Feature,
  MembershipRole,
  Organization,
  OrganizationFeature,
  OrganizationMembership,
  Permission,
  Plan,
  PlanFeature,
  Role,
  RolePermission,
} from '../../database/models';

export interface ResolvedAccess {
  organizationId: string;
  membershipId: string;
  roles: { id: string; key: string; name: string }[];
  permissions: Map<string, PermissionScope>;
  features: Set<ModuleKey>;
}

const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.key);

/** Folds role grants into a permission → broadest-scope map, keeping only entitled modules. */
export function foldPermissions(
  grants: { key: string; scope: PermissionScope }[],
  features: Set<ModuleKey>,
): Map<string, PermissionScope> {
  const out = new Map<string, PermissionScope>();
  for (const g of grants) {
    const def = getPermission(g.key);
    if (!def || !features.has(def.module)) continue;
    const scope = def.scopable ? g.scope : 'ORGANIZATION';
    const existing = out.get(g.key);
    out.set(g.key, existing ? maxScope(existing, scope) : scope);
  }
  return out;
}

/** Applies plan features and per-organization overrides on top of the always-on core modules. */
export function computeEntitlements(planFeatureKeys: string[], overrides: { key: string; enabled: boolean }[]): Set<ModuleKey> {
  const set = new Set<string>([...CORE_MODULES, ...planFeatureKeys]);
  for (const o of overrides) {
    if (CORE_MODULES.includes(o.key as ModuleKey)) continue;
    if (o.enabled) set.add(o.key);
    else set.delete(o.key);
  }
  return new Set([...set].filter((k): k is ModuleKey => MODULES.some((m) => m.key === k)));
}

/**
 * Resolves a user's effective access in an organization. Runs on every authenticated request (before
 * a tenant context exists), so tenant auto-scoping is bypassed and organization filters are explicit.
 */
@Injectable()
export class AccessService {
  async entitlements(organizationId: string): Promise<Set<ModuleKey>> {
    const org = await Organization.findByPk(organizationId, {
      attributes: ['id'],
      include: [
        { model: Plan, attributes: ['id'], include: [{ model: PlanFeature, include: [{ model: Feature, attributes: ['key'] }] }] },
        { model: OrganizationFeature, attributes: ['enabled'], include: [{ model: Feature, attributes: ['key'] }] },
      ],
    });
    if (!org) throw AppError.notFound('Organization');
    return computeEntitlements(
      (org.plan?.features ?? []).map((f) => f.feature!.key),
      (org.features ?? []).map((f) => ({ key: f.feature!.key, enabled: f.enabled })),
    );
  }

  /**
   * Throws when the organization is not active or the membership is not active.
   * Membership is looked up by (organizationId, userId) so a client-supplied org id is only
   * honoured when the user genuinely belongs to it.
   */
  async resolve(userId: string, organizationId: string): Promise<ResolvedAccess> {
    const membership = await OrganizationMembership.findOne({
      where: { organizationId, userId },
      attributes: ['id', 'status'],
      include: [
        { model: Organization, attributes: ['status'] },
        {
          model: MembershipRole,
          attributes: ['id'],
          include: [
            {
              model: Role,
              attributes: ['id', 'key', 'name'],
              include: [{ model: RolePermission, attributes: ['scope'], include: [{ model: Permission, attributes: ['key'] }] }],
            },
          ],
        },
      ],
      skipTenantScope: true,
    });

    if (!membership) throw AppError.forbidden('You are not a member of this organization');
    if (membership.organization?.status !== 'ACTIVE') {
      throw new AppError('ORGANIZATION_INACTIVE', 'This organization is not active');
    }
    if (membership.status !== 'ACTIVE') throw AppError.forbidden('Your access to this organization is not active');

    const features = await this.entitlements(organizationId);
    const roles = (membership.roles ?? []).map((r) => r.role!);
    const grants = roles.flatMap((r) => (r.permissions ?? []).map((p) => ({ key: p.permission!.key, scope: p.scope as PermissionScope })));

    return {
      organizationId,
      membershipId: membership.id,
      roles: roles.map(({ id, key, name }) => ({ id, key, name })),
      permissions: foldPermissions(grants, features),
      features,
    };
  }
}
