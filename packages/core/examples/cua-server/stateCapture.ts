import type { Page } from "@browserbasehq/stagehand";
import { BrowserState, Viewport } from "./types";

/**
 * Get the current viewport dimensions from a page
 */
export async function getViewport(page: Page): Promise<Viewport> {
  try {
    const { w, h } = await page
      .mainFrame()
      .evaluate<{
        w: number;
        h: number;
      }>("({ w: window.innerWidth, h: window.innerHeight })");
    return { width: w, height: h };
  } catch {
    // Default fallback if evaluation fails
    return { width: 1280, height: 720 };
  }
}

/**
 * Take a screenshot and return as base64 string
 */
export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ fullPage: false });
  return buffer.toString("base64");
}

/**
 * Get the current URL from a page
 */
export function getUrl(page: Page): string {
  return page.url();
}

/**
 * Capture the full browser state (screenshot, URL, viewport)
 */
export async function captureBrowserState(page: Page): Promise<BrowserState> {
  const [screenshot, viewport] = await Promise.all([
    takeScreenshot(page),
    getViewport(page),
  ]);

  return {
    screenshot,
    url: getUrl(page),
    viewport,
  };
}
