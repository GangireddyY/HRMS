import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/auth/decorators';
import { AppConfig } from '../../config/app-config.service';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { jobQueue, metricsRegistry } from '../../infrastructure/observability/metrics';

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Prometheus scrape endpoint. Needs `Authorization: Bearer <METRICS_TOKEN>`; without a token configured it answers
 * 404 (required in production). Holds counts and timings only, no tenant or personal data.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ path: 'metrics', version: '1' })
export class MetricsController {
  constructor(
    private readonly config: AppConfig,
    private readonly jobs: JobQueueService,
  ) {}

  @Get()
  async scrape(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const token = this.config.get('METRICS_TOKEN');
    if (!token) return res.status(404).end();
    if (!authorization?.startsWith('Bearer ') || !same(authorization.slice(7), token)) return res.status(401).set('WWW-Authenticate', 'Bearer').end();
    const q = await this.jobs.stats().catch(() => null);
    if (q) {
      jobQueue.set({ state: 'pending' }, q.pending);
      jobQueue.set({ state: 'failed' }, q.failed);
      jobQueue.set({ state: 'oldest_due_seconds' }, q.oldestPendingSeconds ?? 0);
    }
    res.set('Content-Type', metricsRegistry.contentType).send(await metricsRegistry.metrics());
  }
}
