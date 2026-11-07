import sharp from 'sharp';
import type { Test } from 'supertest';
import { API, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

const binary = (req: Test) =>
  req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  }) as unknown as Promise<{ status: number; headers: Record<string, string>; body: Buffer }>;

describe('Profile photos (e2e)', () => {
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

  it('uploads a photo cropped square, serves it only by its versioned URL and removes it', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();

    expect((await ctx.http().post(`${API}/auth/me/avatar`).attach('file', photo, 'me.jpg')).status).toBe(401);
    expect((await ctx.http().post(`${API}/auth/me/avatar`).set(h).attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'me.png')).status).toBe(422);
    expect((await ctx.http().post(`${API}/auth/me/avatar`).set(h)).status).toBe(422);

    const up = await ctx.http().post(`${API}/auth/me/avatar`).set(h).attach('file', photo, 'me.jpg');
    expect(up.status).toBe(201);
    const url = up.body.data.avatarUrl as string;
    expect(url).toMatch(new RegExp(`^/users/${org.admin.id}/avatar\\?v=[0-9a-f]{16}$`));
    expect((await ctx.http().get(`${API}/auth/me`).set(h)).body.data.user.avatarUrl).toBe(url);
    expect((await ctx.http().get(`${API}/users`).set(h)).body.data.find((m: { userId: string }) => m.userId === org.admin.id).avatarUrl).toBe(url);

    const img = await binary(ctx.http().get(`${API}${url}`));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect(await sharp(img.body).metadata()).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect((await ctx.http().get(`${API}/users/${org.admin.id}/avatar`)).status).toBe(404);
    expect((await ctx.http().get(`${API}/users/${org.admin.id}/avatar?v=0000000000000000`)).status).toBe(404);

    // A new photo gets a new URL; the old one stops working.
    const second = await ctx.http().post(`${API}/auth/me/avatar`).set(h).attach('file', await sharp({ create: { width: 300, height: 300, channels: 3, background: '#cc3333' } }).png().toBuffer(), 'me.png');
    expect(second.body.data.avatarUrl).not.toBe(url);
    expect((await ctx.http().get(`${API}${url}`)).status).toBe(404);

    expect((await ctx.http().delete(`${API}/auth/me/avatar`).set(h)).status).toBe(200);
    expect((await ctx.http().get(`${API}/auth/me`).set(h)).body.data.user.avatarUrl).toBeNull();
    expect((await ctx.http().get(`${API}${second.body.data.avatarUrl}`)).status).toBe(404);
  });
});
