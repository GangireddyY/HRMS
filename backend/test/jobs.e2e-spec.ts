import type { AppConfig } from '../src/config/app-config.service';
import { JobQueueService, backoffSeconds } from '../src/infrastructure/jobs/job-queue.service';
import type { ErrorReporter } from '../src/infrastructure/observability/error-reporter';
import { API, TestContext, createTestApp, resetDatabase } from './helpers';

describe('Background jobs and health (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
    await ctx.db.sequelize.query('DELETE FROM background_jobs');
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A queue on the real table (tests normally run jobs inline). */
  function queue() {
    const errors = { capture: jest.fn() };
    const config = { isTest: false } as unknown as AppConfig;
    return { jobs: new JobQueueService(ctx.db, config, errors as unknown as ErrorReporter), errors };
  }
  const row = async (id: string) =>
    (await ctx.db.select<{ status: string; attempts: number; last_error: string | null; due_in: number }>(`SELECT status, attempts, last_error, EXTRACT(EPOCH FROM run_at - now())::int AS due_in FROM background_jobs WHERE id = :id`, { id }))[0]!;

  it('runs a job committed with its transaction, and none for a rolled-back one', async () => {
    const { jobs } = queue();
    const seen: string[] = [];
    jobs.register<{ n: string }>('test.echo', async (p) => void seen.push(p.n));
    const kept = await ctx.db.transaction((transaction) => jobs.enqueue('test.echo', { n: 'kept' }, { transaction, organizationId: null }));
    await jobs.enqueue('test.echo', { n: 'no transaction' }, { organizationId: null });
    await expect(ctx.db.transaction(async (transaction) => {
      await jobs.enqueue('test.echo', { n: 'rolled back' }, { transaction, organizationId: null });
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(await jobs.tick()).toBe(2);
    expect(seen.sort()).toEqual(['kept', 'no transaction']);
    expect((await row(kept)).status).toBe('DONE');
    expect(await jobs.tick()).toBe(0);
  });

  it('retries with backoff, then keeps the job as FAILED and reports it', async () => {
    const { jobs, errors } = queue();
    let calls = 0;
    jobs.register('test.flaky', async () => {
      calls++;
      throw new Error('SendGrid 503');
    });
    const id = await jobs.enqueue('test.flaky', {}, { organizationId: null, maxAttempts: 2 });
    await jobs.tick();
    let r = await row(id);
    expect(r).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'SendGrid 503' });
    expect(r.due_in).toBeGreaterThan(backoffSeconds(1) - 5);
    await ctx.db.sequelize.query(`UPDATE background_jobs SET run_at = now() WHERE id = :id`, { replacements: { id } });
    await jobs.tick();
    r = await row(id);
    expect(r).toMatchObject({ status: 'FAILED', attempts: 2 });
    expect(calls).toBe(2);
    expect(errors.capture).toHaveBeenCalledTimes(1);
    expect(await jobs.stats()).toMatchObject({ pending: 0, failed: 1 });
  });

  it('picks up a job left RUNNING by a server that stopped', async () => {
    const { jobs } = queue();
    const done: string[] = [];
    jobs.register('test.once', async () => void done.push('x'));
    const id = await jobs.enqueue('test.once', {}, { organizationId: null });
    await ctx.db.sequelize.query(`UPDATE background_jobs SET status = 'RUNNING', locked_at = now() - interval '1 hour', attempts = 1 WHERE id = :id`, { replacements: { id } });
    await jobs.tick();
    expect(done).toEqual(['x']);
    expect((await row(id)).status).toBe('DONE');
  });

  it('reports liveness and readiness without tenant data', async () => {
    expect((await ctx.http().get(`${API}/health/live`)).body.data).toMatchObject({ status: 'ok' });
    const ready = await ctx.http().get(`${API}/health/ready`);
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({ status: 'ok', database: 'up', redis: 'off', virusScanner: 'off', jobs: { pending: 0, failed: 0 } });
  });
});
