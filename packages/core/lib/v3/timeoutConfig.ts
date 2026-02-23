import { TimeoutError } from "./types/public/sdkErrors.js";

export function getEnvTimeoutMs(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const normalized = raw.trim().replace(/ms$/i, "");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new TimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
