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

const hardStopped = new WeakSet<AbortSignal>();
const hardStopWaiters = new WeakMap<AbortSignal, { promise: Promise<void>; resolve: () => void }>();

function hardStopWaiter(signal: AbortSignal): { promise: Promise<void>; resolve: () => void } {
  let waiter = hardStopWaiters.get(signal);
  if (!waiter) {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    waiter = { promise, resolve };
    hardStopWaiters.set(signal, waiter);
  }
  return waiter;
}

/**
 * Resolves once the run has been stopped hard and its sessions are closed.
 * Rows race against it: a task that keeps retrying against its dead session
 * must not hold the run open after the user said "stop now".
 */
export function whenHardStopped(signal: AbortSignal): Promise<void> {
  return hardStopWaiter(signal).promise;
}

/**
 * True once the run was stopped hard (in-flight rows killed). The signal's
 * reason can't say so: AbortController keeps its first reason, and a hard stop
 * usually follows a cooperative one.
 */
export function isHardStopped(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && hardStopped.has(signal);
}

export async function abortActiveRun(
  controller: AbortController,
  mode: "cooperative" | "aggressive",
): Promise<void> {
  // AbortController keeps the first reason forever. A second Escape therefore
  // cannot upgrade a cooperative abort by calling abort("aggressive") again.
  if (!controller.signal.aborted) controller.abort(mode);
  if (mode === "aggressive") {
    hardStopped.add(controller.signal);
    try {
      await cleanupActiveRunResources();
    } finally {
      hardStopWaiter(controller.signal).resolve();
    }
  }
}

/**
 * Esc during a run: the first press stops after in-flight rows, a second
 * press within `windowMs` (or any press once already stopping) stops now.
 * Shared by the REPL and argv mode so both behave the same.
 */
export function stopRunOnEscape(
  controller: AbortController,
  onStopping: (mode: "cooperative" | "aggressive") => void,
): void {
  const mode = controller.signal.aborted ? "aggressive" : "cooperative";
  onStopping(mode);
  void abortActiveRun(controller, mode);
}
