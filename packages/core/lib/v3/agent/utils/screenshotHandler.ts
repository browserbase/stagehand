import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Page } from "../../understudy/page.js";
import { getConfigDir } from "../../eventStore.js";

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

export async function persistAgentScreenshotArtifact(
  sessionId: string,
  screenshot: Buffer,
): Promise<string | undefined> {
  try {
    const rootDir = getConfigDir() || path.join(os.tmpdir(), "stagehand");
    const screenshotDir = path.join(
      rootDir,
      "sessions",
      sessionId,
      "artifacts",
      "agent-screenshots",
    );
    const screenshotPath = path.join(
      screenshotDir,
      `${Date.now()}-${randomUUID()}.png`,
    );

    await fs.promises.mkdir(screenshotDir, { recursive: true });
    await fs.promises.writeFile(screenshotPath, screenshot);
    return screenshotPath;
  } catch {
    return undefined;
  }
}
