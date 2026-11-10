import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { MODULES, PERMISSIONS, SYSTEM_ROLE_TEMPLATES } from '../../contracts';
import { Op } from 'sequelize';
import { Feature, Permission, Plan, PlanFeature, Role, RolePermission } from '../../database/models';
import { DEFAULT_PLANS } from '../../infrastructure/seed/platform-bootstrap';

/** Catalog sync spans all organizations by design. */
const ALL_TENANTS = { skipTenantScope: true } as const;

/**
 * Keeps the `features` and `permissions` tables in sync with the code catalog on every boot.
 * Newly introduced permissions are granted to existing system roles whose template includes them,
 * without re-adding permissions administrators intentionally removed.
 */
@Injectable()
export class CatalogSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogSyncService.name);

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<{ created: string[]; removed: string[] }> {
    const features = new Map((await Feature.findAll()).map((f) => [f.key, f]));
    const launched: Feature[] = [];
    for (const m of MODULES) {
      const row = { name: m.name, description: m.description, isCore: m.core };
      const current = features.get(m.key);
      if (!current) launched.push(await Feature.create({ key: m.key, ...row }));
      else if (current.name !== row.name || current.description !== row.description || current.isCore !== row.isCore) await current.update(row);
    }
    // A module launched after the plans exist joins the standard plans that list it (once, when it first appears).
    if (features.size && launched.length) await this.addLaunchedModulesToPlans(launched);

    const existing = await Permission.findAll();
    const existingByKey = new Map(existing.map((p) => [p.key, p]));
    const catalogKeys = new Set(PERMISSIONS.map((p) => p.key));
    const created: string[] = [];

    for (const p of PERMISSIONS) {
      const row = { module: p.module, page: p.page, description: p.description, isScopable: p.scopable, isRestricted: !!p.restricted };
      const current = existingByKey.get(p.key);
      if (!current) {
        await Permission.create({ key: p.key, ...row });
        created.push(p.key);
      } else if (
        current.module !== row.module || current.page !== row.page || current.description !== row.description ||
        current.isScopable !== row.isScopable || current.isRestricted !== row.isRestricted
      ) {
        await current.update(row);
      }
    }

    const removed = existing.filter((p) => !catalogKeys.has(p.key)).map((p) => p.key);
    if (removed.length) {
      this.logger.warn(`Removing permissions no longer in catalog: ${removed.join(', ')}`);
      await Permission.destroy({ where: { key: { [Op.in]: removed } } });
    }

    if (existing.length > 0 && created.length > 0) await this.grantNewPermissionsToSystemRoles(created);
    if (created.length || removed.length) {
      this.logger.log(`Permission catalog synced (+${created.length} / -${removed.length})`);
    }
    return { created, removed };
  }

  private async addLaunchedModulesToPlans(launched: Feature[]): Promise<void> {
    const plans = await Plan.findAll({ where: { code: DEFAULT_PLANS.map((p) => p.code) }, attributes: ['id', 'code'] });
    const rows = plans.flatMap((plan) => {
      const seed = DEFAULT_PLANS.find((p) => p.code === plan.code)!;
      return launched.filter((f) => seed.features.includes(f.key)).map((f) => ({ planId: plan.id, featureId: f.id }));
    });
    if (rows.length) await PlanFeature.bulkCreate(rows, { ignoreDuplicates: true });
    this.logger.log(`New modules added to standard plans: ${launched.map((f) => f.key).join(', ')}`);
  }

  private async grantNewPermissionsToSystemRoles(newKeys: string[]): Promise<void> {
    const newSet = new Set(newKeys);
    const permissionIds = new Map(
      (await Permission.findAll({ where: { key: { [Op.in]: newKeys } }, attributes: ['id', 'key'] })).map((p) => [p.key, p.id]),
    );
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const grants = template.grants.filter((g) => newSet.has(g.key));
      if (!grants.length) continue;
      const roles = await Role.findAll({ where: { key: template.key, isSystem: true }, attributes: ['id', 'organizationId'], ...ALL_TENANTS });
      const rows = roles.flatMap((role) =>
        grants.map((g) => ({ organizationId: role.organizationId, roleId: role.id, permissionId: permissionIds.get(g.key)!, scope: g.scope })),
      );
      if (rows.length) await RolePermission.bulkCreate(rows, { ignoreDuplicates: true, ...ALL_TENANTS });
    }
  }
}
