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
  const validSignals = signals.filter(
    (s): s is AbortSignal => s !== undefined,
  );

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

  for (const signal of validSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }

    signal.addEventListener(
      "abort",
      () => {
        controller.abort(signal.reason);
      },
      { once: true },
    );
  }

  return controller.signal;
}
