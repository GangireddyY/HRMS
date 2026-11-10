import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OrganizationMembership } from '../src/database/models';
import { API, RAW, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase } from './helpers';

/** Collects webhook POSTs; answers with `status`. */
class Receiver {
  server!: Server;
  url = '';
  status = 200;
  readonly received: { headers: IncomingHttpHeaders; body: string }[] = [];
  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        this.received.push({ headers: req.headers, body });
        res.writeHead(this.status, { 'content-type': 'text/plain' });
        res.end(this.status < 300 ? 'ok' : 'nope');
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/hooks`;
  }
}

const settle = async (check: () => boolean, ms = 3000) => {
  const until = Date.now() + ms;
  while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
};

describe('Integrations: API keys and webhooks (e2e)', () => {
  let ctx: TestContext;
  const receiver = new Receiver();

  beforeAll(async () => {
    ctx = await createTestApp();
    await receiver.start();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    receiver.received.length = 0;
    receiver.status = 200;
  });
  afterAll(async () => {
    receiver.server.close();
    await ctx.close();
  });

  async function setup() {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const member = await createUser(ctx, {});
    await addMember(ctx, org.organization.id, member.id, ['employee']);
    const mh = bearer((await login(ctx, member.email)).accessToken);
    return { org, h, member, mh };
  }

  it('issues read-only API keys that act within their permissions', async () => {
    const s = await setup();
    const base = `${API}/integrations/api-keys`;
    expect((await ctx.http().get(base).set(s.mh)).status).toBe(403);
    const grantable = (await ctx.http().get(`${base}/permissions`).set(s.h)).body.data as { key: string }[];
    expect(grantable.map((g) => g.key)).toEqual(expect.arrayContaining(['employee.view', 'leave.view']));
    expect(grantable.map((g) => g.key)).not.toContain('employee.create');

    expect((await ctx.http().post(base).set(s.h).send({ name: 'Writer', permissions: ['employee.create'] })).status).toBe(422);
    expect((await ctx.http().post(base).set(s.h).send({ name: 'Old', permissions: ['employee.view'], expiresAt: '2020-01-01T00:00:00Z' })).status).toBe(422);
    const created = (await ctx.http().post(base).set(s.h).send({ name: 'BI dashboard', permissions: ['employee.view'] })).body.data;
    expect(created.key).toMatch(/^hrms_[A-Za-z0-9_-]{40}$/);
    expect(created).toMatchObject({ name: 'BI dashboard', prefix: created.key.slice(0, 13), status: 'ACTIVE', permissions: ['employee.view'] });
    const listed = (await ctx.http().get(base).set(s.h)).body.data;
    expect(JSON.stringify(listed)).not.toContain(created.key);
    expect(JSON.stringify(listed)).not.toContain('keyHash');

    const key = { Authorization: `Bearer ${created.key}` };
    const employees = await ctx.http().get(`${API}/employees`).set(key);
    expect(employees.status).toBe(200);
    expect((await ctx.http().get(`${API}/leave/requests?view=all`).set(key)).status).toBe(403);
    const write = await ctx.http().post(`${API}/employees`).set(key).send({ firstName: 'X', lastName: 'Y', dateOfJoining: '2026-01-01' });
    expect(write.status).toBe(403);
    expect(write.body.error.message).toMatch(/read-only/);
    expect((await ctx.http().get(base).set(s.h)).body.data[0].lastUsedAt).not.toBeNull();

    // The key acts for its creator: when they lose access, so does the key.
    const admin2 = await createUser(ctx, {});
    const m2 = await addMember(ctx, s.org.organization.id, admin2.id, ['org_admin']);
    const h2 = bearer((await login(ctx, admin2.email)).accessToken);
    const second = (await ctx.http().post(base).set(h2).send({ name: 'Second', permissions: ['employee.view'] })).body.data;
    expect((await ctx.http().get(`${API}/employees`).set({ Authorization: `Bearer ${second.key}` })).status).toBe(200);
    await OrganizationMembership.update({ status: 'SUSPENDED' }, { where: { id: m2.id }, ...RAW });
    expect((await ctx.http().get(`${API}/employees`).set({ Authorization: `Bearer ${second.key}` })).status).toBe(401);

    // Revoked keys stop working.
    expect((await ctx.http().post(`${base}/${created.id}/revoke`).set(s.h).send({})).status).toBe(201);
    expect((await ctx.http().get(`${API}/employees`).set(key)).status).toBe(401);
    expect((await ctx.http().get(`${API}/employees`).set({ Authorization: 'Bearer hrms_not-a-real-key' })).status).toBe(401);
  });

  it('delivers signed events to subscribed webhooks, logs deliveries and can redeliver', async () => {
    const s = await setup();
    const base = `${API}/integrations/webhooks`;
    expect((await ctx.http().post(base).set(s.h).send({ url: receiver.url, events: ['leave'] })).status).toBe(422);
    const hook = (await ctx.http().post(base).set(s.h).send({ url: receiver.url, events: ['employee.*'], description: 'People sync' })).body.data;
    expect(hook.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await ctx.http().get(base).set(s.h)).body.data)).not.toContain(hook.secret);

    // An employee is created: one signed delivery.
    const emp = await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: 'Kiran', lastName: 'Shah', dateOfJoining: '2026-11-02' });
    expect(emp.status).toBe(201);
    await settle(() => receiver.received.length >= 1);
    expect(receiver.received).toHaveLength(1);
    const { headers, body } = receiver.received[0]!;
    expect(headers['x-hrms-event']).toBe('employee.created');
    const [t, v1] = String(headers['x-hrms-signature']).split(',').map((p) => p.split('=')[1]);
    expect(v1).toBe(createHmac('sha256', hook.secret).update(`${t}.${body}`).digest('hex'));
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({ event: 'employee.created', organizationId: s.org.organization.id, data: { entityType: 'Employee', entityId: emp.body.data.id } });
    expect(payload.id).toBe(headers['x-hrms-delivery']);

    // Not subscribed, and never sent (sign-ins, integration changes).
    await login(ctx, s.member.email);
    await ctx.http().patch(`${base}/${hook.id}`).set(s.h).send({ description: 'People sync (HRIS)' });
    await new Promise((r) => setTimeout(r, 300));
    expect(receiver.received).toHaveLength(1);

    // A failing endpoint: the delivery is logged with the response; redelivering succeeds.
    receiver.status = 500;
    await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: 'Meena', lastName: 'Iyer', dateOfJoining: '2026-11-03' });
    await settle(() => receiver.received.length >= 2);
    await new Promise((r) => setTimeout(r, 200));
    let detail = (await ctx.http().get(`${base}/${hook.id}`).set(s.h)).body.data;
    const failed = detail.deliveries.find((d: { status: string }) => d.status === 'FAILED');
    expect(failed).toMatchObject({ event: 'employee.created', responseStatus: 500, responseBody: 'nope', attempts: 1 });
    expect(detail).toMatchObject({ consecutiveFailures: 1, lastStatus: 500 });
    receiver.status = 200;
    expect((await ctx.http().post(`${base}/${hook.id}/deliveries/${failed.id}/redeliver`).set(s.h).send({})).status).toBe(201);
    await settle(() => receiver.received.length >= 3);
    await new Promise((r) => setTimeout(r, 200));
    detail = (await ctx.http().get(`${base}/${hook.id}`).set(s.h)).body.data;
    expect(detail.deliveries.filter((d: { status: string }) => d.status === 'SUCCESS')).toHaveLength(2);
    expect(detail.consecutiveFailures).toBe(0);

    // Ping, rotate the secret, switch off.
    const ping = (await ctx.http().post(`${base}/${hook.id}/test`).set(s.h).send({})).body.data;
    expect(ping).toMatchObject({ event: 'ping', status: 'SUCCESS', responseStatus: 200 });
    const rotated = (await ctx.http().post(`${base}/${hook.id}/rotate-secret`).set(s.h).send({})).body.data;
    expect(rotated.secret).not.toBe(hook.secret);
    await ctx.http().post(`${base}/${hook.id}/test`).set(s.h).send({});
    const last = receiver.received.at(-1)!;
    const [t2, v2] = String(last.headers['x-hrms-signature']).split(',').map((p) => p.split('=')[1]);
    expect(v2).toBe(createHmac('sha256', rotated.secret).update(`${t2}.${last.body}`).digest('hex'));
    await ctx.http().patch(`${base}/${hook.id}`).set(s.h).send({ enabled: false });
    const before = receiver.received.length;
    await ctx.http().post(`${API}/employees`).set(s.h).send({ firstName: 'Ravi', lastName: 'K', dateOfJoining: '2026-11-04' });
    await new Promise((r) => setTimeout(r, 300));
    expect(receiver.received).toHaveLength(before);
    expect((await ctx.http().get(base).set(s.mh)).status).toBe(403);
  });
});
