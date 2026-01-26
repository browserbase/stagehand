import type { V3 } from "@browserbasehq/stagehand";

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

export async function endBrowserbaseSession(v3?: V3 | null): Promise<void> {
  if (!v3?.isBrowserbase) return;
  if ((process.env.USE_API ?? "").toLowerCase() === "true") return;

  try {
    await settleWithTimeout(
      v3.context.conn.send("Browser.close"),
      CLOSE_TIMEOUT_MS,
    );
  } catch {
    // best-effort cleanup
  }
}
