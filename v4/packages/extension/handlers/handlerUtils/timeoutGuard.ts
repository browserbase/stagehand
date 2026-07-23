import { TimeoutError } from "../../errors.js";

export type TimeoutGuard = () => void;

export function createTimeoutGuard(
  timeout?: number,
  errorFactory?: (timeout: number) => Error,
): TimeoutGuard {
  if (!timeout || timeout <= 0) {
    return () => {};
  }

  const startTime = Date.now();
  return () => {
    if (Date.now() - startTime >= timeout) {
      const err = errorFactory?.(timeout) ?? new TimeoutError("operation", timeout);
      throw err;
    }
  };
}
