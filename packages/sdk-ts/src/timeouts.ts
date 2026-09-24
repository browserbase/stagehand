import { abortable } from "./abort.js";

export const STAGEHAND_INIT_TIMEOUT_MS = 60_000;

export class RPCResponseTimeoutError extends Error {
  constructor(
    readonly method: string,
    readonly timeoutMs: number,
  ) {
    super(`RPC response timed out after ${timeoutMs}ms: ${method}`, {
      cause: { method, timeoutMs },
    });
    this.name = "RPCResponseTimeoutError";
  }
}

export async function withStagehandInitDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(
      new Error(`Stagehand initialization timed out after ${STAGEHAND_INIT_TIMEOUT_MS}ms`),
    );
  }, STAGEHAND_INIT_TIMEOUT_MS);

  try {
    return await abortable(operation(controller.signal), controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
