import { API, TestContext, bearer, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Prometheus metrics (e2e)', () => {
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

  it('serves counts and timings by route pattern to the scraper only', async () => {
    const url = `${API}/metrics`;
    expect((await ctx.http().get(url)).status).toBe(401);
    expect((await ctx.http().get(url).set(bearer('wrong-token-wrong-token-wrong'))).status).toBe(401);

    const { admin } = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, admin.email)).accessToken);
    const someone = (await ctx.http().get(`${API}/users`).set(h)).body.data[0];
    await ctx.http().get(`${API}/users/${someone.id}`).set(h);
    await ctx.http().post(`${API}/auth/login`).send({ email: admin.email, password: 'definitely-wrong-1' });

    const res = await ctx.http().get(url).set(bearer(process.env.METRICS_TOKEN!));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    const text = res.text;
    expect(text).toMatch(/hrms_http_requests_total\{[^}]*method="GET"[^}]*route="\/api\/v1\/users\/:id"[^}]*status="200"/);
    // Raw ids never become label values.
    expect(text).not.toContain(someone.id);
    expect(text).toMatch(/hrms_http_request_duration_seconds_bucket\{/);
    expect(text).toMatch(/hrms_auth_failures_total\{[^}]*outcome="FAILURE"[^}]*\} [1-9]/);
    expect(text).toMatch(/hrms_job_queue\{[^}]*state="pending"/);
    expect(text).toMatch(/process_cpu_user_seconds_total/);
  });
});
