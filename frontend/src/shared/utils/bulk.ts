/** Runs one request per id (a few at a time) and reports how many succeeded and which failed. */
export async function runBulk(ids: string[], action: (id: string) => Promise<unknown>, concurrency = 4): Promise<{ done: number; failed: string[] }> {
  const failed: string[] = [];
  let done = 0;
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++]!;
      try {
        await action(id);
        done++;
      } catch {
        failed.push(id);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { done, failed };
}
