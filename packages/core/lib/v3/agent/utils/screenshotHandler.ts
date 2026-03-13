import type { Page } from "../../understudy/page.js";

/**
 * Default delay in milliseconds to wait after vision actions before capturing screenshot.
 * Allows the page to settle after interactions.
 */
const DEFAULT_DELAY_MS = 500;

/**
 * Waits for the page to settle and captures a screenshot.
 * If the screenshot fails (e.g., page closed, navigation in progress),
 * returns undefined instead of throwing - allowing the action to still succeed.
 *
 * @param page - The page to capture
 * @param delayMs - Delay before capturing (default: 500ms, pass 0 to skip delay)
 */
export async function waitAndCaptureScreenshot(
  page: Page,
  delayMs: number = DEFAULT_DELAY_MS,
): Promise<string | undefined> {
  if (delayMs > 0) {
    await page.waitForTimeout(delayMs);
  }

  try {
    const buffer = await page.screenshot({ fullPage: false });
    return buffer.toString("base64");
  } catch {
    return undefined;
  }
}
