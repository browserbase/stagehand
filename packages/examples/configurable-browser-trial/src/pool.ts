/** Run async tasks with a bounded concurrency limit, preserving input order. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onResult?: (result: R, item: T, index: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const size = Math.max(1, Math.min(limit, items.length));

  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      const r = await worker(items[i], i);
      results[i] = r;
      onResult?.(r, items[i], i);
    }
  }

  await Promise.all(Array.from({ length: size }, runner));
  return results;
}
