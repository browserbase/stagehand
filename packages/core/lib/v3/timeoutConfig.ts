import { TimeoutError } from "./types/public/sdkErrors.js";
import {
  combineAbortSignals,
  getActiveAbortSignal,
  runWithAbortSignal,
} from "./cancellation.js";

type TimeoutOperation<T> =
  | Promise<T>
  | ((signal: AbortSignal | undefined) => Promise<T>);

export interface WithTimeoutOptions {
  signal?: AbortSignal;
  errorFactory?: (timeoutMs: number) => Error;
}

export function getEnvTimeoutMs(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/ms$/i, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export async function withTimeout<T>(
  operationPromise: TimeoutOperation<T>,
  timeoutMs: number | null | undefined,
  operation: string,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const parentSignal = combineAbortSignals(
    getActiveAbortSignal(),
    options.signal,
  );

  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    parentSignal?.throwIfAborted();
    return await runWithAbortSignal(parentSignal, () =>
      typeof operationPromise === "function"
        ? operationPromise(parentSignal)
        : operationPromise,
    );
  }

  const timeoutController = new AbortController();
  const signal = combineAbortSignals(parentSignal, timeoutController.signal);
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error =
        options.errorFactory?.(timeoutMs) ??
        new TimeoutError(operation, timeoutMs);
      timeoutController.abort(error);
      reject(error);
    }, timeoutMs);
  });

  let onAbort: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      })
    : undefined;

  try {
    signal?.throwIfAborted();
    const runningOperation = runWithAbortSignal(signal, () =>
      typeof operationPromise === "function"
        ? operationPromise(signal)
        : operationPromise,
    );
    return await Promise.race([
      runningOperation,
      timeoutPromise,
      ...(abortPromise ? [abortPromise] : []),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}
