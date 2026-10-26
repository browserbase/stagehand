export type AsyncCloser = {
  close(): Promise<unknown>;
};

export const STDIO_SHUTDOWN_GRACE_MS = 5_000;

export async function closeCodeModeStdio(
  resources: readonly AsyncCloser[],
  timeoutMs = STDIO_SHUTDOWN_GRACE_MS,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const cleanup = Promise.allSettled(
    resources.map((resource) => Promise.resolve().then(() => resource.close())),
  ).then((results) => results.every((result) => result.status === "fulfilled"));
  const deadline = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
    timeout.unref();
  });

  try {
    return await Promise.race([cleanup, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
