import { TimeoutError } from "./types/public/sdkErrors.js";

export const DEFAULT_TOOL_TIMEOUT_MS = 45_000;

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

/**
 * Wraps an AI SDK tool's execute function with a timeout guard.
 * On timeout, returns `{ success: false, error: "..." }` to the LLM.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapToolWithTimeout<T extends Record<string, any>>(
  agentTool: T,
  timeoutMs: number,
  toolName: string,
): T {
  if (!agentTool.execute) return agentTool;

  const originalExecute = agentTool.execute as (
    ...args: unknown[]
  ) => Promise<unknown>;
  return {
    ...agentTool,
    execute: async (...args: unknown[]) => {
      try {
        return await withTimeout(originalExecute(...args), timeoutMs, toolName);
      } catch (error) {
        return {
          success: false,
          error: (error as Error)?.message ?? String(error),
        };
      }
    },
  } as T;
}
