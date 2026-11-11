import { QueryTypes } from 'sequelize';
import { RequestContext } from '../src/common/context/request-context';
import { Department, Role, TENANT_MODELS } from '../src/database/models';
import { TestContext, createOrgWithAdmin, createTestApp, resetDatabase } from './helpers';

/** Database-level tenant isolation: PostgreSQL row-level security behind the ORM's tenant hooks. */
describe('Row-level security (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const count = async (sql: string, opts: { skipTenantScope?: boolean } = {}) =>
    Number((await ctx.db.sequelize.query<{ n: string }>(sql, { type: QueryTypes.SELECT, ...opts }))[0]!.n);

  it('is forced on every organization-owned table', async () => {
    const rows = await ctx.db.sequelize.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`,
      { type: QueryTypes.SELECT },
    );
    const by = new Map(rows.map((r) => [r.relname, r]));
    const unprotected = TENANT_MODELS.map((m) => m.getTableName() as string).filter((t) => !by.get(t)?.relrowsecurity || !by.get(t)?.relforcerowsecurity);
    expect(unprotected).toEqual([]);
  });

  it("confines raw SQL to the request's organization, unless the statement opts out", async () => {
    const a = await createOrgWithAdmin(ctx);
    const b = await createOrgWithAdmin(ctx);
    const total = await count('SELECT count(*) AS n FROM roles');
    const mine = await RequestContext.runForTenant(a.organization.id, () => count('SELECT count(*) AS n FROM roles'));
    const theirs = await RequestContext.runForTenant(a.organization.id, () => count(`SELECT count(*) AS n FROM roles WHERE organization_id = '${b.organization.id}'`));
    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(total);
    expect(theirs).toBe(0);
    expect(await RequestContext.runForTenant(a.organization.id, () => count('SELECT count(*) AS n FROM roles', { skipTenantScope: true }))).toBe(total);

    // Nested includes of another organization's rows come back empty too.
    const role = await Role.findOne({ where: { organizationId: b.organization.id }, skipTenantScope: true, rejectOnEmpty: true });
    const joined = await RequestContext.runForTenant(a.organization.id, () =>
      count(`SELECT count(*) AS n FROM membership_roles mr JOIN roles r ON r.id = mr.role_id WHERE r.id = '${role.id}'`),
    );
    expect(joined).toBe(0);
  });

  it('refuses writes into another organization, inside and outside transactions', async () => {
    const a = await createOrgWithAdmin(ctx);
    const b = await createOrgWithAdmin(ctx);
    const insert = (org: string) => `INSERT INTO departments (id, organization_id, name, created_at, updated_at) VALUES (gen_random_uuid(), '${org}', 'Shadow ${org.slice(0, 4)}', now(), now())`;
    await expect(RequestContext.runForTenant(a.organization.id, () => ctx.db.sequelize.query(insert(b.organization.id)))).rejects.toThrow(/row-level security/);
    await RequestContext.runForTenant(a.organization.id, () => ctx.db.sequelize.query(insert(a.organization.id)));

    await expect(
      RequestContext.runForTenant(a.organization.id, () => ctx.db.transaction((transaction) => ctx.db.sequelize.query(insert(b.organization.id), { transaction }))),
    ).rejects.toThrow(/row-level security/);
    // Updates can't reach the other organization's rows either.
    const [, moved] = (await RequestContext.runForTenant(a.organization.id, () =>
      ctx.db.transaction(async (transaction) => ctx.db.sequelize.query(`UPDATE departments SET name = 'Taken' WHERE organization_id = '${b.organization.id}'`, { transaction })),
    )) as [unknown, { rowCount: number }];
    expect(moved.rowCount).toBe(0);

    // Inside one transaction, scoped and opted-out statements each see their own rows; the transaction's
    // isolation level is still set first.
    await RequestContext.runForTenant(a.organization.id, () =>
      ctx.db.sequelize.transaction({ isolationLevel: 'SERIALIZABLE' as never }, async (transaction) => {
        expect(await Department.count({ transaction })).toBe(1);
        expect(Number((await ctx.db.sequelize.query<{ n: string }>('SELECT count(*) AS n FROM departments', { type: QueryTypes.SELECT, transaction }))[0]!.n)).toBe(1);
        expect(Number((await ctx.db.sequelize.query<{ n: string }>('SELECT count(*) AS n FROM departments', { type: QueryTypes.SELECT, transaction, skipTenantScope: true }))[0]!.n)).toBe(1);
        expect(await Department.count({ transaction, skipTenantScope: true, where: { organizationId: b.organization.id } })).toBe(0);
      }),
    );
    // Outside any tenant context (identity, platform, jobs) everything is visible.
    expect(await count('SELECT count(*) AS n FROM departments')).toBe(1);
  });
});
