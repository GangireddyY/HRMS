import { describe, expect, it } from 'vitest';
import { fetchAllPages } from './fetch-all';

function source(total: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: number[] = [];
  let running = 0;
  let peak = 0;
  const fetchPage = async (page: number, pageSize: number) => {
    calls.push(page);
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  };
  return { fetchPage, calls, peak: () => peak };
}

describe('fetchAllPages', () => {
  it('returns every row in order, a few pages at a time', async () => {
    const s = source(950);
    const rows = await fetchAllPages(s.fetchPage, { pageSize: 100, concurrency: 3 });
    expect(rows).toHaveLength(950);
    expect(rows[0]).toBe(0);
    expect(rows[949]).toBe(949);
    expect(s.calls.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.peak()).toBeLessThanOrEqual(3);
  });

  it('makes one request for a single page and stops at the safety ceiling', async () => {
    const one = source(40);
    expect(await fetchAllPages(one.fetchPage)).toHaveLength(40);
    expect(one.calls).toEqual([1]);
    const big = source(1000);
    expect(await fetchAllPages(big.fetchPage, { pageSize: 100, maxRows: 250 })).toHaveLength(250);
    expect(big.calls).toHaveLength(3);
  });
});
