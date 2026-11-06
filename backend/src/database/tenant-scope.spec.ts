import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { RequestContext } from '../common/context/request-context';
import { ALL_MODELS, TENANT_MODELS } from './models';
import { assertRowTenant, resolveTenant, scopeWhere, TenantIsolationError } from './tenant-scope';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('scopeWhere', () => {
  it('adds the tenant filter when there is no where clause', () => {
    expect(scopeWhere(undefined, ORG)).toEqual({ organizationId: ORG });
    expect(scopeWhere({}, ORG)).toEqual({ organizationId: ORG });
  });

  it('AND-combines with the caller filter so it can never be widened', () => {
    const scoped = scopeWhere({ key: 'x' }, ORG) as Record<symbol, unknown>;
    expect(scoped[Op.and]).toEqual([{ key: 'x' }, { organizationId: ORG }]);
  });

  it('keeps a foreign organizationId filter but adds the tenant filter (yielding no rows)', () => {
    const scoped = scopeWhere({ organizationId: OTHER }, ORG) as Record<symbol, unknown>;
    expect(scoped[Op.and]).toEqual([{ organizationId: OTHER }, { organizationId: ORG }]);
  });

  it('preserves symbol-only filters', () => {
    const scoped = scopeWhere({ [Op.or]: [{ a: 1 }, { b: 2 }] }, ORG) as Record<symbol, unknown>;
    expect(scoped[Op.and]).toHaveLength(2);
  });
});

describe('assertRowTenant', () => {
  it('assigns the tenant to new rows', () => {
    const row: { organizationId?: string | null } = {};
    assertRowTenant('Role', row, ORG);
    expect(row.organizationId).toBe(ORG);
  });

  it('rejects rows for another organization', () => {
    expect(() => assertRowTenant('Role', { organizationId: OTHER }, ORG)).toThrow(TenantIsolationError);
  });
});

describe('resolveTenant', () => {
  it('fails closed without a tenant context', () => {
    expect(() => resolveTenant('Role', 'find', {})).toThrow(TenantIsolationError);
  });

  it('honours an explicit opt-out', () => {
    expect(resolveTenant('Role', 'find', { skipTenantScope: true })).toBeNull();
  });

  it('returns the context organization', async () => {
    await RequestContext.runForTenant(ORG, () => expect(resolveTenant('Role', 'find', {})).toBe(ORG));
  });
});

describe('TENANT_MODELS coverage', () => {
  // Models are only inspected; no connection is opened.
  const sequelize = new Sequelize({ dialect: 'postgres', logging: false, models: ALL_MODELS });
  afterAll(() => sequelize.close());
  const attributes = (m: unknown) => (m as { getAttributes(): Record<string, { allowNull?: boolean } | undefined> }).getAttributes();

  it('includes every model with a required organizationId column', () => {
    const owned = ALL_MODELS.filter((m) => attributes(m).organizationId?.allowNull === false).map((m) => m.name);
    const registered = new Set(TENANT_MODELS.map((m) => m.name));
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.filter((m) => !registered.has(m))).toEqual([]);
  });

  it('only lists models that have an organizationId column', () => {
    for (const model of TENANT_MODELS) expect(attributes(model).organizationId).toBeDefined();
  });
});
