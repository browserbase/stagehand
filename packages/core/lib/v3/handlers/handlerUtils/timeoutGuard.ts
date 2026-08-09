import { TimeoutError } from "../../types/public/sdkErrors.js";
import { throwIfAborted } from "../../cancellation.js";

export type TimeoutGuard = () => void;

export function createTimeoutGuard(
  timeoutMs?: number,
  errorFactory?: (timeoutMs: number) => Error,
): TimeoutGuard {
  if (!timeoutMs || timeoutMs <= 0) {
    return () => throwIfAborted();
  }

  const startTime = Date.now();
  return () => {
    throwIfAborted();
    if (Date.now() - startTime >= timeoutMs) {
      const err =
        errorFactory?.(timeoutMs) ?? new TimeoutError("operation", timeoutMs);
      throw err;
    }
  };
}
