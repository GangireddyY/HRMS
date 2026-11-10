import type { AddressInfo } from 'node:net';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { TestContext, createOrgWithAdmin, createTestApp, login, resetDatabase } from './helpers';

describe('Notification stream (e2e)', () => {
  let ctx: TestContext;
  let base: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const server = ctx.app.getHttpServer();
    if (!server.listening) await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** Reads server-sent events until `want` arrives (or times out). */
  async function waitFor(reader: ReadableStreamDefaultReader<Uint8Array>, want: string, ms = 5000): Promise<string[]> {
    const seen: string[] = [];
    const decoder = new TextDecoder();
    let buffer = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now()))]);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const m of buffer.matchAll(/^event: (\w+)$/gm)) seen.push(m[1]!);
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
      if (seen.includes(want)) return seen;
    }
    return seen;
  }

  it('pushes an event to the signed-in user when a notification arrives, and needs a session', async () => {
    const org = await createOrgWithAdmin(ctx);
    const session = await login(ctx, org.admin.email);
    expect((await fetch(`${base}/notifications/stream`)).status).toBe(401);

    const controller = new AbortController();
    const res = await fetch(`${base}/notifications/stream`, { headers: { Authorization: `Bearer ${session.accessToken}` }, signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    expect(await waitFor(reader, 'ready')).toContain('ready');

    await ctx.app.get(NotificationsService).notify(org.admin.id, { type: 'test', title: 'Hello' });
    expect(await waitFor(reader, 'notification')).toContain('notification');
    controller.abort();
  });
});
