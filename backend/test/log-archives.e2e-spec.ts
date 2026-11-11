import { randomUUID } from 'node:crypto';
import { AuditLog, LogArchive, Permission, Role, RolePermission } from '../src/database/models';
import { RetentionLockedError, StorageService } from '../src/infrastructure/storage/storage.service';
import { API, PASSWORD, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

describe('Audit log archives (e2e)', () => {
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

  /** audit.purge is restricted (no system role has it), so the archivist role is created directly. */
  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const role = await Role.create({ organizationId: org.organization.id, key: 'archivist', name: 'Archivist' }, RAW);
    const perms = await Permission.findAll({ where: { key: ['audit.view', 'audit.purge'] } });
    await RolePermission.bulkCreate(perms.map((p) => ({ organizationId: org.organization.id, roleId: role.id, permissionId: p.id, scope: 'ORGANIZATION' as const })), RAW);
    const user = await createUser(ctx, { email: uniqueEmail('arch') });
    await addMember(ctx, org.organization.id, user.id, ['archivist']);
    const h = bearer((await login(ctx, user.email)).accessToken);
    const admin = bearer((await login(ctx, org.admin.email)).accessToken);
    // Old entries (the audit trail is append-only, so they're inserted with their dates).
    for (const day of ['2026-01-05', '2026-01-20', '2026-02-10']) {
      await ctx.db.sequelize.query(`INSERT INTO audit_logs (id, organization_id, action, entity_type, summary, created_at) VALUES (:id, :org, 'test.old', 'Test', 'Old entry', :at)`, {
        replacements: { id: randomUUID(), org: org.organization.id, at: `${day}T10:00:00Z` },
      });
    }
    return { org, h, admin };
  }

  it('archives, downloads (step-up) and then deletes exactly the archived records', async () => {
    const s = await setup();
    const url = `${API}/log-archives`;
    expect((await ctx.http().get(url).set(s.admin)).status).toBe(403);
    expect((await ctx.http().post(url).set(s.h).send({ kind: 'AUDIT_LOG', before: '2099-01-01' })).status).toBe(422);
    expect((await ctx.http().get(`${url}/preview`).query({ kind: 'AUDIT_LOG', before: '2026-02-01' }).set(s.h)).body.data.count).toBe(2);

    const created = await ctx.http().post(url).set(s.h).send({ kind: 'AUDIT_LOG', before: '2026-02-01' });
    expect(created.status).toBe(201);
    const archive = created.body.data;
    expect(archive).toMatchObject({ recordCount: 2, status: 'ARCHIVED', downloadedAt: null });
    // The file is write-once for the retention period (7 years by default): it can't be deleted, even by the API.
    const lockedDays = (new Date(archive.lockedUntil).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(lockedDays)).toBe(2557);
    const stored = await LogArchive.findByPk(archive.id, RAW);
    await expect(ctx.app.get(StorageService).delete(stored!.storageKey)).rejects.toBeInstanceOf(RetentionLockedError);
    expect(await AuditLog.count({ where: { organizationId: s.org.organization.id, action: 'test.old' }, ...RAW })).toBe(3);

    // Not deletable before the file was downloaded; the download needs a fresh step-up.
    expect((await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 2 })).status).toBe(403);
    expect((await ctx.http().post(`${API}/auth/step-up`).set(s.h).send({ password: PASSWORD })).status).toBe(200);
    expect((await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 2 })).status).toBe(409);
    const file = await ctx.http().get(`${url}/${archive.id}/file`).set(s.h).buffer(true).parse((r, cb) => {
      let body = '';
      r.on('data', (c: Buffer) => (body += c.toString()));
      r.on('end', () => cb(null, body));
    });
    expect(file.status).toBe(200);
    expect((file.body as string).split('\r\n').filter((l) => l.includes('test.old'))).toHaveLength(2);

    expect((await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 3 })).status).toBe(422);
    const purged = await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 2 });
    expect(purged.status).toBe(201);
    expect(purged.body.data).toMatchObject({ status: 'PURGED', purgedCount: 2 });
    expect(await AuditLog.count({ where: { organizationId: s.org.organization.id, action: 'test.old' }, ...RAW })).toBe(1);
    // The purge itself stays on record, and the archive can't be purged twice.
    expect(await AuditLog.count({ where: { organizationId: s.org.organization.id, action: 'audit.purged' }, ...RAW })).toBe(1);
    expect((await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 2 })).status).toBe(409);
  });

  it('refuses to delete when the records changed after archiving', async () => {
    const s = await setup();
    const url = `${API}/log-archives`;
    const archive = (await ctx.http().post(url).set(s.h).send({ kind: 'AUDIT_LOG', before: '2026-02-01' })).body.data;
    await ctx.http().post(`${API}/auth/step-up`).set(s.h).send({ password: PASSWORD });
    await ctx.http().get(`${url}/${archive.id}/file`).set(s.h);
    await ctx.db.sequelize.query(`INSERT INTO audit_logs (id, organization_id, action, entity_type, created_at) VALUES (:id, :org, 'test.late', 'Test', '2026-01-25T10:00:00Z')`, {
      replacements: { id: randomUUID(), org: s.org.organization.id },
    });
    const res = await ctx.http().post(`${url}/${archive.id}/purge`).set(s.h).send({ recordCount: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/no longer match/);
    expect(await AuditLog.count({ where: { organizationId: s.org.organization.id, action: 'test.old' }, ...RAW })).toBe(3);
  });
});
