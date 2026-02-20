import type { V3 } from "../v3.js";

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
