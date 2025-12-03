/**
 * Combines multiple AbortSignals into a single signal that aborts when any of them abort.
 *
 * Uses AbortSignal.any() if available (Node 20+), otherwise falls back to a manual implementation.
 *
 * @param signals - Array of AbortSignals to combine (undefined signals are filtered out)
 * @returns A combined AbortSignal, or undefined if no valid signals provided
 */
export function combineAbortSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal | undefined {
  const validSignals = signals.filter((s): s is AbortSignal => s !== undefined);

  if (validSignals.length === 0) {
    return undefined;
  }

  if (validSignals.length === 1) {
    return validSignals[0];
  }

  // Use AbortSignal.any() if available (Node 20+)
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(validSignals);
  }

  // Fallback for older environments
  const controller = new AbortController();

  // Track abort handlers so we can clean them up when one signal aborts
  const handlers: Array<{ signal: AbortSignal; handler: () => void }> = [];

  const cleanup = () => {
    for (const { signal, handler } of handlers) {
      signal.removeEventListener("abort", handler);
    }
  };

  for (const signal of validSignals) {
    if (signal.aborted) {
      cleanup(); // Remove handlers added to previous signals in this loop
      controller.abort(signal.reason);
      return controller.signal;
    }

    const handler = () => {
      cleanup(); // Remove all listeners to prevent memory leak
      controller.abort(signal.reason);
    };

    handlers.push({ signal, handler });
    signal.addEventListener("abort", handler, { once: true });
  }

  return controller.signal;
}
