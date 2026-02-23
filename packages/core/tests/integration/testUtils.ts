import type { V3 } from "../../lib/v3/v3.js";

/**
 * Races a promise against a timeout.
 * Resolves to the promise value or "timeout" if the deadline expires.
 */
export function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const CLOSE_TIMEOUT_MS = 5_000;

async function settleWithTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<void> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([promise.catch(() => {}), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function closeV3(v3?: V3 | null): Promise<void> {
  if (!v3) return;
  const isBrowserbase = v3.isBrowserbase;
  if (isBrowserbase) {
    try {
      await settleWithTimeout(
        v3.context.conn.send("Browser.close"),
        CLOSE_TIMEOUT_MS,
      );
    } catch {
      // best-effort cleanup
    }
  }

  await settleWithTimeout(v3.close(), CLOSE_TIMEOUT_MS);
}
