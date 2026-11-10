type Results<T extends readonly (() => unknown)[]> = { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };

/**
 * `Promise.all` for queries inside a transaction: they share one connection, and pg (from v9) refuses a query while
 * another is still running on it, so they run one after another.
 */
export async function inSequence<T extends readonly (() => unknown)[]>(...tasks: T): Promise<Results<T>> {
  const out: unknown[] = [];
  for (const task of tasks) out.push(await task());
  return out as Results<T>;
}
