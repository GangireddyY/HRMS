import { Injectable } from '@nestjs/common';
import { Op, QueryTypes, type QueryOptionsWithType } from 'sequelize';
import { DELEGABLE_PERMISSIONS, MODULES, ModuleKey, PermissionScope, getPermission, maxScope, type DelegatedGrant } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { zonedParts } from '../../common/utils/zoned-time';
import { ApprovalDelegation, Employee, MembershipRole, Organization, OrganizationMembership, Permission, Role, RolePermission, User } from '../../database/models';

export interface ResolvedAccess {
  organizationId: string;
  membershipId: string;
  roles: { id: string; key: string; name: string }[];
  permissions: Map<string, PermissionScope>;
  features: Set<ModuleKey>;
  /** Approvals held on behalf of someone else (approval delegation). */
  delegated: DelegatedGrant[];
}

const CORE_MODULES = MODULES.filter((m) => m.core).map((m) => m.key);

/** Folds role grants into a permission → broadest-scope map, keeping only entitled modules. */
export function foldPermissions(grants: { key: string; scope: PermissionScope }[], features: Set<ModuleKey>): Map<string, PermissionScope> {
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

/** Flat rows read on every request; no model instances are built (they dominated the request's CPU time). */
function select<T extends object>(sql: string, replacements: Record<string, unknown>): Promise<T[]> {
  return Organization.sequelize!.query<T>(sql, { replacements, type: QueryTypes.SELECT, skipTenantScope: true } as QueryOptionsWithType<QueryTypes.SELECT>);
}

/**
 * Resolves a user's effective access in an organization. Runs on every authenticated request (before
 * a tenant context exists), so tenant auto-scoping is bypassed and organization filters are explicit.
 */
@Injectable()
export class AccessService {
  async entitlements(organizationId: string): Promise<Set<ModuleKey>> {
    const rows = await select<{ source: 'ORG' | 'PLAN' | 'OVERRIDE'; key: string | null; enabled: boolean }>(
      `SELECT 'ORG' AS source, NULL AS key, true AS enabled FROM organizations WHERE id = :organizationId
       UNION ALL
       SELECT 'PLAN', f.key, true FROM organizations o JOIN plan_features pf ON pf.plan_id = o.plan_id JOIN features f ON f.id = pf.feature_id WHERE o.id = :organizationId
       UNION ALL
       SELECT 'OVERRIDE', f.key, x.enabled FROM organization_features x JOIN features f ON f.id = x.feature_id WHERE x.organization_id = :organizationId`,
      { organizationId },
    );
    if (!rows.some((r) => r.source === 'ORG')) throw AppError.notFound('Organization');
    return computeEntitlements(
      rows.filter((r) => r.source === 'PLAN').map((r) => r.key!),
      rows.filter((r) => r.source === 'OVERRIDE').map((r) => ({ key: r.key!, enabled: r.enabled })),
    );
  }

  /**
   * Throws when the organization is not active or the membership is not active.
   * Membership is looked up by (organizationId, userId) so a client-supplied org id is only
   * honoured when the user genuinely belongs to it.
   */
  async resolve(userId: string, organizationId: string): Promise<ResolvedAccess> {
    const [[membership], grants, features] = await Promise.all([
      select<{ id: string; status: string; organizationStatus: string; timezone: string | null }>(
        `SELECT m.id, m.status, o.status AS "organizationStatus", o.timezone
           FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
          WHERE m.organization_id = :organizationId AND m.user_id = :userId`,
        { organizationId, userId },
      ),
      select<{ roleId: string; roleKey: string; roleName: string; permission: string | null; scope: PermissionScope | null }>(
        `SELECT r.id AS "roleId", r.key AS "roleKey", r.name AS "roleName", p.key AS permission, rp.scope
           FROM organization_memberships m
           JOIN membership_roles mr ON mr.membership_id = m.id
           JOIN roles r ON r.id = mr.role_id
           LEFT JOIN role_permissions rp ON rp.role_id = r.id
           LEFT JOIN permissions p ON p.id = rp.permission_id
          WHERE m.organization_id = :organizationId AND m.user_id = :userId`,
        { organizationId, userId },
      ),
      this.entitlements(organizationId).catch((e: unknown) => e as Error),
    ]);

    if (!membership) throw AppError.forbidden('You are not a member of this organization');
    if (membership.organizationStatus !== 'ACTIVE') {
      throw new AppError('ORGANIZATION_INACTIVE', 'This organization is not active');
    }
    if (membership.status !== 'ACTIVE') throw AppError.forbidden('Your access to this organization is not active');
    if (features instanceof Error) throw features;

    const roles = new Map<string, { id: string; key: string; name: string }>();
    for (const g of grants) roles.set(g.roleId, { id: g.roleId, key: g.roleKey, name: g.roleName });
    const today = zonedParts(new Date(), membership.timezone ?? 'UTC').date;

    return {
      organizationId,
      membershipId: membership.id,
      roles: [...roles.values()],
      permissions: foldPermissions(
        grants.filter((g) => g.permission).map((g) => ({ key: g.permission!, scope: g.scope! })),
        features,
      ),
      features,
      delegated: await this.delegatedGrants(organizationId, membership.id, features, today),
    };
  }

  /**
   * Approval rights handed to this member by people who are away: the delegator's own (not delegated) approval
   * permissions, with the delegator's scope, while the delegation runs and the delegator is still an active member.
   */
  private async delegatedGrants(organizationId: string, membershipId: string, features: Set<ModuleKey>, today: string): Promise<DelegatedGrant[]> {
    const delegations = await ApprovalDelegation.findAll({
      where: { organizationId, delegateMembershipId: membershipId, revokedAt: null, startsOn: { [Op.lte]: today }, endsOn: { [Op.gte]: today } },
      include: [{ model: OrganizationMembership, as: 'delegator', where: { status: 'ACTIVE' }, attributes: ['id', 'userId'], include: [ROLE_INCLUDE] }],
      skipTenantScope: true,
    });
    if (!delegations.length) return [];
    const delegatorIds = delegations.map((d) => d.delegatorMembershipId);
    const [employees, users] = await Promise.all([
      Employee.findAll({ where: { organizationId, membershipId: delegatorIds }, attributes: ['id', 'membershipId', 'departmentId', 'firstName', 'lastName'], skipTenantScope: true }),
      User.findAll({ where: { id: delegations.map((d) => d.delegator!.userId) }, attributes: ['id', 'firstName', 'lastName'] }),
    ]);
    const out: DelegatedGrant[] = [];
    for (const d of delegations) {
      const employee = employees.find((e) => e.membershipId === d.delegatorMembershipId) ?? null;
      const user = users.find((u) => u.id === d.delegator!.userId);
      const held = foldPermissions(grantsOf(d.delegator!), features);
      for (const permission of DELEGABLE_PERMISSIONS) {
        const scope = held.get(permission);
        if (!scope || scope === 'OWN') continue;
        out.push({
          permission,
          scope,
          delegatorMembershipId: d.delegatorMembershipId,
          delegatorEmployeeId: employee?.id ?? null,
          delegatorDepartmentId: employee?.departmentId ?? null,
          delegatorName: employee ? fullName(employee) : user ? fullName(user) : 'A colleague',
          endsOn: d.endsOn,
        });
      }
    }
    return out;
  }
}

const ROLE_INCLUDE = {
  model: MembershipRole,
  attributes: ['id'],
  include: [
    {
      model: Role,
      attributes: ['id', 'key', 'name'],
      include: [{ model: RolePermission, attributes: ['scope'], include: [{ model: Permission, attributes: ['key'] }] }],
    },
  ],
};

function grantsOf(membership: OrganizationMembership): { key: string; scope: PermissionScope }[] {
  return (membership.roles ?? []).flatMap((r) => (r.role?.permissions ?? []).map((p) => ({ key: p.permission!.key, scope: p.scope as PermissionScope })));
}
