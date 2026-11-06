import { Op, type WhereOptions } from 'sequelize';
import type { Model, ModelCtor } from 'sequelize-typescript';
import { RequestContext } from '../common/context/request-context';

declare module 'sequelize' {
  interface Logging {
    /**
     * Opt out of automatic tenant scoping. Only for identity/auth, platform administration and
     * bootstrap paths that validate tenancy explicitly.
     */
    skipTenantScope?: boolean;
  }
}

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantIsolationError';
  }
}

interface ScopableOptions {
  skipTenantScope?: boolean;
  where?: WhereOptions;
}

/** Returns the organization to scope to, or null when the caller opted out. Fails closed otherwise. */
export function resolveTenant(model: string, operation: string, options: { skipTenantScope?: boolean } | undefined): string | null {
  if (options?.skipTenantScope) return null;
  const orgId = RequestContext.organizationId();
  if (!orgId) throw new TenantIsolationError(`No tenant context for ${model}.${operation}`);
  return orgId;
}

/**
 * AND-combines the caller's filter with the tenant filter, so a foreign organizationId can never widen access.
 * `key` is the attribute name, or the column name for operations whose options are already field-mapped.
 */
export function scopeWhere(where: WhereOptions | undefined, orgId: string, key = 'organizationId'): WhereOptions {
  const tenant = { [key]: orgId };
  if (!where || (typeof where === 'object' && Object.keys(where).length === 0 && Object.getOwnPropertySymbols(where).length === 0)) {
    return tenant;
  }
  return { [Op.and]: [where, tenant] };
}

/** Assigns the tenant on new rows and rejects rows that target another organization. */
export function assertRowTenant(model: string, row: { organizationId?: string | null }, orgId: string): void {
  if (row.organizationId === undefined || row.organizationId === null) {
    row.organizationId = orgId;
    return;
  }
  if (row.organizationId !== orgId) throw new TenantIsolationError(`Cross-tenant write on ${model} rejected`);
}

type TenantRow = Model & { organizationId?: string | null; changed(key: string): boolean };

/**
 * Installs hooks that constrain every read, write and delete on tenant models to the request's
 * organization. Nested `include`s are not hooked; they are constrained by their (scoped) parent and by
 * composite tenant foreign keys in the database.
 */
export function installTenantHooks(models: ModelCtor[]): void {
  for (const model of models) {
    const name = model.name;
    const column = (model.getAttributes() as Record<string, { field?: string }>).organizationId?.field ?? 'organization_id';
    const scopeQuery = (operation: string, key?: string) => (options: ScopableOptions) => {
      const orgId = resolveTenant(name, operation, options);
      if (orgId) options.where = scopeWhere(options.where, orgId, key);
    };

    model.addHook('beforeFind', 'tenant-scope', scopeQuery('find'));
    model.addHook('beforeCount', 'tenant-scope', scopeQuery('count'));
    // Model.destroy maps attribute names to columns before running this hook.
    model.addHook('beforeBulkDestroy', 'tenant-scope', scopeQuery('destroy', column));
    model.addHook('beforeBulkUpdate', 'tenant-scope', (options: ScopableOptions & { attributes?: Record<string, unknown> }) => {
      const orgId = resolveTenant(name, 'update', options);
      if (!orgId) return;
      const target = options.attributes?.organizationId;
      if (target !== undefined && target !== orgId) throw new TenantIsolationError(`Changing the organization of ${name} is not allowed`);
      options.where = scopeWhere(options.where, orgId);
    });
    model.addHook('beforeCreate', 'tenant-scope', (row: TenantRow, options: ScopableOptions) => {
      const orgId = resolveTenant(name, 'create', options);
      if (orgId) assertRowTenant(name, row, orgId);
    });
    model.addHook('beforeBulkCreate', 'tenant-scope', (rows: TenantRow[], options: ScopableOptions) => {
      const orgId = resolveTenant(name, 'bulkCreate', options);
      if (orgId) for (const row of rows) assertRowTenant(name, row, orgId);
    });
    model.addHook('beforeUpdate', 'tenant-scope', (row: TenantRow, options: ScopableOptions) => {
      const orgId = resolveTenant(name, 'save', options);
      if (!orgId) return;
      if (row.changed('organizationId') || row.organizationId !== orgId) {
        throw new TenantIsolationError(`Cross-tenant update on ${name} rejected`);
      }
    });
    model.addHook('beforeDestroy', 'tenant-scope', (row: TenantRow, options: ScopableOptions) => {
      const orgId = resolveTenant(name, 'destroy', options);
      if (orgId && row.organizationId !== orgId) throw new TenantIsolationError(`Cross-tenant delete on ${name} rejected`);
    });
    model.addHook('beforeUpsert', 'tenant-scope', () => {
      throw new TenantIsolationError(`upsert is not supported on tenant model ${name}; use find + create/update`);
    });
  }
}
