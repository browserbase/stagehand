const activeRunCleanups = new Map<symbol, () => Promise<void>>();

export function onceAsync(fn: () => Promise<void>): () => Promise<void> {
  let promise: Promise<void> | undefined;
  return () => {
    promise ??= fn();
    return promise;
  };
}

export function registerActiveRunCleanup(cleanup: () => Promise<void>): () => void {
  const key = Symbol("active-run-cleanup");
  activeRunCleanups.set(key, cleanup);
  return () => {
    activeRunCleanups.delete(key);
  };
}

export async function cleanupActiveRunResources(): Promise<void> {
  const cleanups = [...activeRunCleanups.entries()];
  for (const [key] of cleanups) activeRunCleanups.delete(key);
  await Promise.allSettled(cleanups.map(([, cleanup]) => Promise.resolve().then(cleanup)));
}

export async function abortActiveRun(
  controller: AbortController,
  mode: "cooperative" | "aggressive",
): Promise<void> {
  // AbortController keeps the first reason forever. A second Escape therefore
  // cannot upgrade a cooperative abort by calling abort("aggressive") again.
  if (!controller.signal.aborted) controller.abort(mode);
  if (mode === "aggressive") await cleanupActiveRunResources();
}
