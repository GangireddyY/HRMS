import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { Transaction } from 'sequelize';
import { RequestContext } from '../../common/context/request-context';
import { AppConfig } from '../../config/app-config.service';
import { DatabaseService } from '../../database/database.service';
import { ErrorReporter } from '../observability/error-reporter';

export interface Job<T = unknown> {
  id: string;
  organizationId: string | null;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}
export type JobHandler<T = unknown> = (payload: T, job: Job<T>) => Promise<void>;

const POLL_MS = 5_000;
const BATCH = 10;
/** A job still RUNNING after this long is assumed lost (server stopped mid-job) and runs again. */
const STALE_MS = 10 * 60_000;
/** Delay before attempt n+1 (seconds). */
const BACKOFF = [30, 120, 600, 3600, 6 * 3600];
const KEEP_DONE_DAYS = 3;
const KEEP_FAILED_DAYS = 30;

export const backoffSeconds = (attempts: number) => BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)]!;

/**
 * Durable background jobs in PostgreSQL (`background_jobs`). Enqueue inside the business transaction and the job
 * exists exactly when the change commits. Every API instance polls; rows are claimed with FOR UPDATE SKIP LOCKED, so
 * each job runs on one instance at a time. Failures retry with backoff (30 s … 6 h); after the last attempt the job
 * is kept as FAILED and reported. Tests run jobs inline when the transaction commits.
 */
@Injectable()
export class JobQueueService implements OnModuleDestroy {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly worker = `${hostname()}:${process.pid}`;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private lastCleanup = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: AppConfig,
    private readonly errors: ErrorReporter,
  ) {}

  register<T>(type: string, handler: JobHandler<T>): void {
    if (this.handlers.has(type)) throw new Error(`Job handler for "${type}" is already registered`);
    this.handlers.set(type, handler as unknown as JobHandler<unknown>);
  }

  async enqueue<T>(type: string, payload: T, opts: { transaction?: Transaction; organizationId?: string | null; runAt?: Date; maxAttempts?: number } = {}): Promise<string> {
    if (!this.handlers.has(type)) throw new Error(`No job handler registered for "${type}"`);
    const id = randomUUID();
    const organizationId = opts.organizationId === undefined ? (RequestContext.organizationId() ?? null) : opts.organizationId;
    if (this.config.isTest) {
      // Inline in tests: after commit (or now), so assertions can read the effect right after the request.
      const job: Job<T> = { id, organizationId, type, payload, attempts: 1, maxAttempts: 1 };
      const run = () => void this.execute(job).catch((e: unknown) => this.logger.error(`Job ${type} failed: ${(e as Error).message}`));
      if (opts.transaction) opts.transaction.afterCommit(run);
      else run();
      return id;
    }
    await this.db.sequelize.query(
      `INSERT INTO background_jobs (id, organization_id, type, payload, max_attempts, run_at) VALUES (:id, :organizationId, :type, CAST(:payload AS jsonb), :maxAttempts, :runAt)`,
      { replacements: { id, organizationId, type, payload: JSON.stringify(payload), maxAttempts: opts.maxAttempts ?? 6, runAt: opts.runAt ?? new Date() }, transaction: opts.transaction },
    );
    return id;
  }

  start(): void {
    if (this.timer || this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Claims and runs due jobs until none are left (one batch at a time). */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let processed = 0;
    try {
      await this.db.select(`UPDATE background_jobs SET status = 'PENDING', locked_at = NULL, locked_by = NULL, updated_at = now() WHERE status = 'RUNNING' AND locked_at < now() - make_interval(secs => :stale) RETURNING id`, { stale: STALE_MS / 1000 });
      for (;;) {
        const jobs = await this.claim();
        if (!jobs.length) break;
        for (const job of jobs) await this.runClaimed(job);
        processed += jobs.length;
      }
      if (Date.now() - this.lastCleanup > 3600_000) await this.cleanup();
    } catch (e) {
      this.logger.warn(`Job run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
    return processed;
  }

  /** Pending and failed counts, for the readiness check. */
  async stats(): Promise<{ pending: number; failed: number; oldestPendingSeconds: number | null }> {
    const [row] = await this.db.select<{ pending: string; failed: string; oldest: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'PENDING') AS pending,
              count(*) FILTER (WHERE status = 'FAILED') AS failed,
              EXTRACT(EPOCH FROM now() - min(run_at) FILTER (WHERE status = 'PENDING' AND run_at <= now())) AS oldest
         FROM background_jobs`,
    );
    return { pending: Number(row?.pending ?? 0), failed: Number(row?.failed ?? 0), oldestPendingSeconds: row?.oldest === null || row?.oldest === undefined ? null : Math.round(Number(row.oldest)) };
  }

  private async claim(): Promise<Job[]> {
    const rows = await this.db.select<{ id: string; organization_id: string | null; type: string; payload: unknown; attempts: number; max_attempts: number }>(
      `UPDATE background_jobs SET status = 'RUNNING', locked_at = now(), locked_by = :worker, attempts = attempts + 1, updated_at = now()
        WHERE id IN (SELECT id FROM background_jobs WHERE status = 'PENDING' AND run_at <= now() ORDER BY run_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, organization_id, type, payload, attempts, max_attempts`,
      { worker: this.worker },
    );
    return rows.map((r) => ({ id: r.id, organizationId: r.organization_id, type: r.type, payload: r.payload, attempts: r.attempts, maxAttempts: r.max_attempts }));
  }

  private async runClaimed(job: Job): Promise<void> {
    try {
      await this.execute(job);
      await this.db.select(`UPDATE background_jobs SET status = 'DONE', finished_at = now(), locked_at = NULL, last_error = NULL, updated_at = now() WHERE id = :id RETURNING id`, { id: job.id });
    } catch (e) {
      const message = (e as Error).message?.slice(0, 1000) ?? String(e);
      const last = job.attempts >= job.maxAttempts;
      await this.db.select(
        last
          ? `UPDATE background_jobs SET status = 'FAILED', finished_at = now(), locked_at = NULL, last_error = :message, updated_at = now() WHERE id = :id RETURNING id`
          : `UPDATE background_jobs SET status = 'PENDING', run_at = now() + make_interval(secs => :delay), locked_at = NULL, last_error = :message, updated_at = now() WHERE id = :id RETURNING id`,
        { id: job.id, message, delay: backoffSeconds(job.attempts) },
      );
      if (last) {
        this.logger.error(`Job ${job.type} ${job.id} failed after ${job.attempts} attempts: ${message}`);
        this.errors.capture(e, { tags: { job: job.type }, extra: { jobId: job.id, attempts: job.attempts } });
      } else {
        this.logger.warn(`Job ${job.type} ${job.id} attempt ${job.attempts} failed (retrying in ${backoffSeconds(job.attempts)} s): ${message}`);
      }
    }
  }

  private async execute(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    if (job.organizationId) await RequestContext.runForTenant(job.organizationId, () => handler(job.payload, job), { requestId: `job-${job.id}` });
    else await RequestContext.run({ requestId: `job-${job.id}` }, () => handler(job.payload, job));
  }

  private async cleanup(): Promise<void> {
    this.lastCleanup = Date.now();
    await this.db.select(
      `DELETE FROM background_jobs WHERE (status = 'DONE' AND finished_at < now() - interval '${KEEP_DONE_DAYS} days') OR (status = 'FAILED' AND finished_at < now() - interval '${KEEP_FAILED_DAYS} days') RETURNING id`,
    );
  }
}
