import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * One round trip, atomic: count the hit in a window that starts at the first hit, and block for `blockDuration` once
 * the count passes the limit. Returns hits, window ms left, blocked (0/1), block ms left.
 */
const SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl, limit, block = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local blocked = redis.call('PTTL', blockKey)
if blocked > 0 then
  return { limit + 1, math.max(redis.call('PTTL', hitsKey), 0), 1, blocked }
end
local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local left = redis.call('PTTL', hitsKey)
if left < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  left = ttl
end
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', block)
  return { hits, left, 1, block }
end
return { hits, left, 0, 0 }
`;

/**
 * Shared rate-limit counters, so limits hold across API instances (and survive restarts). While Redis is unreachable
 * each instance counts in memory instead — limits keep working per instance rather than every request failing.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimits');
  private readonly fallback = new ThrottlerStorageService();
  private warned = 0;

  constructor(
    private readonly redis: Redis,
    private readonly prefix = 'hrms:throttle:',
  ) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const base = `${this.prefix}${throttlerName}:${key}`;
    try {
      const [hits, left, blocked, blockLeft] = (await this.redis.eval(SCRIPT, 2, `${base}:hits`, `${base}:block`, ttl, limit, blockDuration > 0 ? blockDuration : ttl)) as [number, number, number, number];
      return { totalHits: hits, timeToExpire: Math.ceil(left / 1000), isBlocked: blocked === 1, timeToBlockExpire: Math.ceil(blockLeft / 1000) };
    } catch (e) {
      if (Date.now() - this.warned > 60_000) {
        this.warned = Date.now();
        this.logger.warn(`Redis unavailable, counting in memory: ${(e as Error).message}`);
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
