import { describe, expect, it } from 'vitest';
import { runBulk } from './bulk';

describe('runBulk', () => {
  it('runs every id with limited concurrency and reports failures', async () => {
    let running = 0;
    let peak = 0;
    const result = await runBulk(['a', 'b', 'c', 'd', 'e', 'f'], async (id) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (id === 'c' || id === 'e') throw new Error('nope');
    }, 2);
    expect(result).toEqual({ done: 4, failed: ['c', 'e'] });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
