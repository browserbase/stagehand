import { AsyncLocalStorage } from "node:async_hooks";

const abortSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();

export function getActiveAbortSignal(): AbortSignal | undefined {
  return abortSignalStorage.getStore();
}

export function runWithAbortSignal<T>(
  signal: AbortSignal | undefined,
  operation: () => T,
): T {
  return abortSignalStorage.run(signal, operation);
}

export function runWithoutAbortSignal<T>(operation: () => T): T {
  return abortSignalStorage.run(undefined, operation);
}

export function combineAbortSignals(
  ...signals: Array<AbortSignal | null | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null,
  );
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  return AbortSignal.any(activeSignals);
}

export function throwIfAborted(
  signal: AbortSignal | undefined = getActiveAbortSignal(),
): void {
  signal?.throwIfAborted();
}

export async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined = getActiveAbortSignal(),
): Promise<T> {
  if (!signal) return await promise;
  signal.throwIfAborted();

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });

  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
