import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { Public } from '../../common/auth/decorators';
import { DatabaseService } from '../../database/database.service';
import { JobQueueService } from '../../infrastructure/jobs/job-queue.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { StorageService } from '../../infrastructure/storage/storage.service';

type Check = 'up' | 'down' | 'off';
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

/**
 * Liveness (`/health/live`: the process answers) and readiness (`/health` and `/health/ready`: dependencies).
 * Not ready (503) only when the database or Redis is down; a stopped virus scanner or a job backlog makes the
 * service "degraded" (uploads or emails wait) without taking the instance out of the load balancer.
 * No tenant or personal data is returned.
 */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly jobs: JobQueueService,
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() };
  }

  @Get()
  check(@Res({ passthrough: true }) res: Response) {
    return this.ready(res);
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: database, Redis, virus scanner and background jobs' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis, scanner, jobs] = await Promise.all([
      within(this.db.select('SELECT 1'), 3000).then((): Check => 'up', (): Check => 'down'),
      this.redis ? within(this.redis.ping(), 2000).then((r): Check => (r === 'PONG' ? 'up' : 'down'), (): Check => 'down') : Promise.resolve<Check>('off'),
      within(this.storage.scannerUp(), 3000).then(
        (s): Check => (s.up === null ? 'off' : s.up ? 'up' : 'down'),
        (): Check => 'down',
      ),
      within(this.jobs.stats(), 3000).catch(() => null),
    ]);
    const backlog = !!jobs && (jobs.oldestPendingSeconds ?? 0) > 15 * 60;
    const notReady = database === 'down' || redis === 'down';
    if (notReady) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: notReady ? 'down' : scanner === 'down' || backlog || (jobs?.failed ?? 0) > 0 ? 'degraded' : 'ok',
      database,
      redis,
      virusScanner: scanner,
      jobs: jobs ? { pending: jobs.pending, failed: jobs.failed, oldestPendingSeconds: jobs.oldestPendingSeconds } : null,
      timestamp: new Date().toISOString(),
    };
  }
}
