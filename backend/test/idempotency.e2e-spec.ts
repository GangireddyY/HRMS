import { Location } from '../src/database/models';
import { API, RAW, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Idempotency keys (e2e)', () => {
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

  it('runs a write once per key and replays the first response', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const post = (key: string | null, name: string) => {
      const req = ctx.http().post(`${API}/locations`).set(h);
      if (key) req.set('Idempotency-Key', key);
      return req.send({ name, state: 'Karnataka' });
    };
    const count = () => Location.count({ where: { organizationId: org.organization.id }, ...RAW });
    const before = await count();

    const first = await post('create-blr-0001', 'Bengaluru');
    expect(first.status).toBe(201);
    const again = await post('create-blr-0001', 'Bengaluru');
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(await count()).toBe(before + 1);

    // Same key, different request: refused. A new key or none: a new write.
    expect((await post('create-blr-0001', 'Mysuru')).status).toBe(409);
    expect((await post('create-mys-0002', 'Mysuru')).status).toBe(201);
    expect((await post('bad key!', 'Hubli')).status).toBe(400);
    expect(await count()).toBe(before + 2);

    // A failed request doesn't use up its key.
    expect((await post('create-dup-0003', 'Bengaluru')).status).toBe(422);
    expect((await post('create-dup-0003', 'Udupi')).status).toBe(201);
  });
});
