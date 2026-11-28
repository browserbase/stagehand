export type AsyncCloser = {
  close(): Promise<unknown>;
};

export const STDIO_SHUTDOWN_GRACE_MS = 5_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export async function closeCodeModeStdio(
  resources: readonly AsyncCloser[],
  timeoutMs = STDIO_SHUTDOWN_GRACE_MS,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const cleanup = Promise.allSettled(
    resources.map((resource) => Promise.resolve().then(() => resource.close())),
  ).then((results) => results.every((result) => result.status === "fulfilled"));
  if (timeoutMs === Number.POSITIVE_INFINITY) {
    return await cleanup;
  }
  const boundedTimeoutMs = Number.isNaN(timeoutMs)
    ? STDIO_SHUTDOWN_GRACE_MS
    : Math.min(Math.max(0, timeoutMs), MAX_TIMEOUT_MS);
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), boundedTimeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([cleanup, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
