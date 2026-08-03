import { TimeoutError } from "./errors.js";

/**
 * Enforce a caller-facing deadline. The supplied promise has no cancellation contract, so timing
 * out does not abort underlying service or model work; callers that need cancellation must pass an
 * abort signal through that operation's own API.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number | null | undefined,
  operation: string,
): Promise<T> {
  if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
    return await promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeout));
    }, timeout);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
