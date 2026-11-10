import { Global, Logger, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/app-config.service';

export const REDIS = Symbol('REDIS');

/** The shared Redis connection (rate limits); null when REDIS_URL isn't set (single-instance development and tests). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Redis | null => {
        const url = config.get('REDIS_URL');
        if (!url || config.isTest) return null;
        const logger = new Logger('Redis');
        const client = new Redis(url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, connectTimeout: 5000, lazyConnect: false });
        client.on('error', (e) => logger.warn(`Redis: ${e.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis | null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
