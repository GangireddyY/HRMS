import type { PaginationMeta } from '@contracts';

/** The API's largest accepted page size (PaginationQueryDto caps pageSize at 100). */
export const MAX_PAGE_SIZE = 100;

/**
 * Every row of a paginated list: page 1 first, then the remaining pages a few at a time.
 * Stops at `maxRows` (default 10,000) as a safety ceiling, so a runaway list can't flood the browser;
 * summaries over larger lists are then computed from the first 10,000 rows.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<{ items: T[]; meta: PaginationMeta }>,
  opts: { pageSize?: number; maxRows?: number; concurrency?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? MAX_PAGE_SIZE;
  const maxRows = opts.maxRows ?? 10_000;
  const concurrency = opts.concurrency ?? 4;
  const first = await fetchPage(1, pageSize);
  const items = [...first.items];
  const lastPage = Math.min(first.meta.totalPages, Math.ceil(maxRows / pageSize));
  for (let start = 2; start <= lastPage; start += concurrency) {
    const batch = Array.from({ length: Math.min(concurrency, lastPage - start + 1) }, (_, i) => fetchPage(start + i, pageSize));
    for (const page of await Promise.all(batch)) items.push(...page.items);
  }
  return items.slice(0, maxRows);
}
