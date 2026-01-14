import type { Page } from "../../understudy/page";
import type { Locator } from "../../understudy/locator";
import { captureWithMask } from "../../understudy/screenshotUtils";

/**
 * Default delay in milliseconds to wait after vision actions before capturing screenshot.
 * Allows the page to settle after interactions.
 */
const DEFAULT_DELAY_MS = 500;

/**
 * Options for screenshot capture with masking support.
 */
export interface ScreenshotCaptureOptions {
  /**
   * Delay before capturing screenshot (default: 500ms, pass 0 to skip delay)
   */
  delayMs?: number;
  /**
   * CSS selectors or Locator objects for elements to mask
   */
  maskSelectors?: (string | Locator)[];
  /**
   * Color for mask overlays (default: #FF00FF)
   */
  maskColor?: string;
}

/**
 * Waits for the page to settle and captures a screenshot with optional masking.
 * If the screenshot fails (e.g., page closed, navigation in progress),
 * returns undefined instead of throwing - allowing the action to still succeed.
 *
 * @param page - The page to capture
 * @param options - Screenshot capture options including delay and mask config,
 *                  or a number for backward-compatible delay-only usage
 */
export async function waitAndCaptureScreenshot(
  page: Page,
  options?: ScreenshotCaptureOptions | number,
): Promise<string | undefined> {
  // Support legacy number parameter for backward compatibility
  const opts: ScreenshotCaptureOptions =
    typeof options === "number" ? { delayMs: options } : (options ?? {});

  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  if (delayMs > 0) {
    await page.waitForTimeout(delayMs);
  }

  try {
    const maskConfig =
      opts.maskSelectors && opts.maskSelectors.length > 0
        ? { selectors: opts.maskSelectors, color: opts.maskColor }
        : undefined;
    const buffer = await captureWithMask(page, maskConfig);
    return buffer.toString("base64");
  } catch {
    return undefined;
  }
}
