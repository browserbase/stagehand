/**
 * Delay in milliseconds to wait after vision actions (click, type, scroll, etc.)
 * to allow the page to settle before taking a screenshot.
 */
export const POST_ACTION_DELAY_MS = 500;

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 */
export function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

