const activeRunCleanups = new Map<symbol, () => Promise<void>>();

export function onceAsync(fn: () => Promise<void>): () => Promise<void> {
  let promise: Promise<void> | undefined;
  return () => {
    promise ??= fn();
    return promise;
  };
}

export function registerActiveRunCleanup(
  cleanup: () => Promise<void>,
): () => void {
  const key = Symbol("active-run-cleanup");
  activeRunCleanups.set(key, cleanup);
  return () => {
    activeRunCleanups.delete(key);
  };
}

export async function cleanupActiveRunResources(): Promise<void> {
  const cleanups = [...activeRunCleanups.values()];
  await Promise.allSettled(cleanups.map((cleanup) => cleanup()));
}
