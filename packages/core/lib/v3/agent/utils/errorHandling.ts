import { AgentAbortError } from "../../types/public/sdkErrors";

/**
 * Extracts the abort signal from instruction or options.
 */
export function extractAbortSignal(
  instructionOrOptions: string | { signal?: AbortSignal },
): AbortSignal | undefined {
  return typeof instructionOrOptions === "object"
    ? instructionOrOptions.signal
    : undefined;
}

/**
 * Consistently extracts an error message from an unknown error.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Checks if an error is abort-related (either an abort error type or the signal was aborted).
 * Returns the appropriate reason string if it's an abort, or null if not.
 *
 * @param error - The caught error
 * @param abortSignal - The abort signal to check
 * @returns The abort reason string if abort-related, null otherwise
 */
export function getAbortErrorReason(
  error: unknown,
  abortSignal?: AbortSignal,
): string | null {
  if (!AgentAbortError.isAbortError(error) && !abortSignal?.aborted) {
    return null;
  }

  // Prefer the signal's reason if available
  if (abortSignal?.reason) {
    return String(abortSignal.reason);
  }

  // Fall back to the error message
  return getErrorMessage(error);
}
