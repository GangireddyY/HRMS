import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { DELEGABLE_PERMISSIONS, MODULES, ModuleKey, PermissionScope, getPermission, maxScope, type DelegatedGrant } from '../../contracts';
import { AppError } from '../../common/errors/app-error';
import { fullName } from '../../common/utils/names';
import { zonedParts } from '../../common/utils/zoned-time';
import {
  ApprovalDelegation,
  Employee,
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
  User,
} from '../../database/models';

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
      include: [{ model: Organization, attributes: ['status', 'timezone'] }, ROLE_INCLUDE],
      skipTenantScope: true,
    });

    if (!membership) throw AppError.forbidden('You are not a member of this organization');
    if (membership.organization?.status !== 'ACTIVE') {
      throw new AppError('ORGANIZATION_INACTIVE', 'This organization is not active');
    }
    if (membership.status !== 'ACTIVE') throw AppError.forbidden('Your access to this organization is not active');

    const features = await this.entitlements(organizationId);
    const roles = (membership.roles ?? []).map((r) => r.role!);
    const today = zonedParts(new Date(), membership.organization.timezone ?? 'UTC').date;

    return {
      organizationId,
      membershipId: membership.id,
      roles: roles.map(({ id, key, name }) => ({ id, key, name })),
      permissions: foldPermissions(grantsOf(membership), features),
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
