import { abortable } from "./abort.js";

export const STAGEHAND_INIT_TIMEOUT_MS = 60_000;

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
