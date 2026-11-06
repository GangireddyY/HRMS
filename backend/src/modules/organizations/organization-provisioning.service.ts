import { Injectable } from '@nestjs/common';
import { SYSTEM_ROLE_TEMPLATES, type OrganizationStatus } from '../../contracts';
import { Op, type Transaction } from 'sequelize';
import { AppError } from '../../common/errors/app-error';
import { Organization, OrganizationSecurityPolicy, Permission, Plan, Role, RolePermission } from '../../database/models';

export interface ProvisionOrganizationInput {
  name: string;
  planId: string;
  status: OrganizationStatus;
  country?: string;
  timezone?: string;
  currency?: string;
  industry?: string;
  companySize?: string;
  email?: string;
  phone?: string;
  createdById?: string | null;
}

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'org'
  );
}

/** Writes into a brand-new organization before any tenant context exists. */
const BOOTSTRAP = { skipTenantScope: true } as const;

/**
 * Creates an organization with its default security policy and system roles.
 * Runs inside the caller's transaction.
 */
@Injectable()
export class OrganizationProvisioningService {
  async provision(
    transaction: Transaction,
    input: ProvisionOrganizationInput,
  ): Promise<{ organization: Organization; roleIdsByKey: Map<string, string> }> {
    const plan = await Plan.findByPk(input.planId, { transaction });
    if (!plan || !plan.isActive) throw AppError.badRequest('Selected plan is not available');

    const slug = await this.uniqueSlug(slugify(input.name), transaction);
    const now = new Date();
    const organization = await Organization.create(
      {
        name: input.name,
        slug,
        status: input.status,
        planId: plan.id,
        country: input.country ?? 'IN',
        timezone: input.timezone ?? 'Asia/Kolkata',
        currency: input.currency ?? 'INR',
        industry: input.industry ?? null,
        companySize: input.companySize ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        activatedAt: input.status === 'ACTIVE' ? now : null,
        createdById: input.createdById ?? null,
        updatedById: input.createdById ?? null,
      },
      { transaction },
    );

    await OrganizationSecurityPolicy.create({ organizationId: organization.id }, { transaction, ...BOOTSTRAP });
    const roleIdsByKey = await this.provisionSystemRoles(organization.id, input.createdById ?? null, transaction);
    return { organization, roleIdsByKey };
  }

  async provisionSystemRoles(organizationId: string, actorId: string | null, transaction: Transaction): Promise<Map<string, string>> {
    const permissions = await Permission.findAll({ attributes: ['id', 'key'], transaction });
    const permissionIds = new Map(permissions.map((p) => [p.key, p.id]));
    const roleIdsByKey = new Map<string, string>();

    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const role = await Role.create(
        {
          organizationId,
          key: template.key,
          name: template.name,
          description: template.description,
          isSystem: true,
          isLocked: template.locked,
          createdById: actorId,
          updatedById: actorId,
        },
        { transaction, ...BOOTSTRAP },
      );
      roleIdsByKey.set(template.key, role.id);
      const rows = template.grants.flatMap((g) => {
        const permissionId = permissionIds.get(g.key);
        return permissionId ? [{ organizationId, roleId: role.id, permissionId, scope: g.scope }] : [];
      });
      if (rows.length) await RolePermission.bulkCreate(rows, { transaction, ...BOOTSTRAP });
    }
    return roleIdsByKey;
  }

  private async uniqueSlug(base: string, transaction: Transaction): Promise<string> {
    const taken = await Organization.findAll({ where: { slug: { [Op.startsWith]: base } }, attributes: ['slug'], transaction });
    const set = new Set(taken.map((t) => t.slug));
    if (!set.has(base)) return base;
    for (let i = 2; i < 10_000; i++) {
      const candidate = `${base}-${i}`;
      if (!set.has(candidate)) return candidate;
    }
    throw AppError.conflict('Could not allocate an organization identifier');
  }
}
