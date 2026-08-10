import { TimeoutError } from "../../types/public/sdkErrors.js";

export type TimeoutGuard = () => void;

export function createTimeoutGuard(
  timeoutMs?: number,
  errorFactory?: (timeoutMs: number) => Error,
): TimeoutGuard {
  if (!timeoutMs || timeoutMs <= 0) {
    return () => {};
  }

  const startTime = Date.now();
  return () => {
    if (Date.now() - startTime >= timeoutMs) {
      const err =
        errorFactory?.(timeoutMs) ?? new TimeoutError("operation", timeoutMs);
      throw err;
    }
  };
}
