import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('maps the script result (milliseconds) to the throttler record (seconds)', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([4, 41_200, 1, 60_000]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis, 't:');
    await expect(storage.increment('ip-1', 60_000, 3, 60_000, 'default')).resolves.toEqual({ totalHits: 4, timeToExpire: 42, isBlocked: true, timeToBlockExpire: 60 });
    expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 2, 't:default:ip-1:hits', 't:default:ip-1:block', 60_000, 3, 60_000);
  });

  it('counts in memory while Redis is unreachable', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('Connection is closed.')) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push((await storage.increment('ip-2', 60_000, 2, 0, 'default')).isBlocked);
    expect(hits).toEqual([false, false, true]);
  });

  // Against a real Redis when REDIS_TEST_URL is set (CI service container).
  const url = process.env.REDIS_TEST_URL;
  (url ? it : it.skip)('limits and blocks across instances sharing Redis', async () => {
    const a = new Redis(url!);
    const b = new Redis(url!);
    try {
      const prefix = `test:${Date.now()}:`;
      const one = new RedisThrottlerStorage(a, prefix);
      const two = new RedisThrottlerStorage(b, prefix);
      const results = [];
      for (const s of [one, two, one, two]) results.push(await s.increment('ip-3', 5_000, 3, 2_000, 'login'));
      expect(results.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
      expect(results.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
      expect((await one.increment('ip-3', 5_000, 3, 2_000, 'login')).isBlocked).toBe(true);
    } finally {
      a.disconnect();
      b.disconnect();
    }
  });
});
