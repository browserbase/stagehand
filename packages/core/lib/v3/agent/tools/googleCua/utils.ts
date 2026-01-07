/**
 * Shared utilities for Google CUA tools
 */

import type { V3 } from "../../../v3";
import type { ModelOutputContentItem } from "../../../types/public/agent";
import { waitAndCaptureScreenshot } from "../../utils/screenshotHandler";
import type { CuaToolResult, CuaModelOutput } from "./types";

/**
 * Get viewport dimensions from the page
 */
export async function getViewportSize(
  v3: V3,
): Promise<{ width: number; height: number }> {
  try {
    const page = await v3.context.awaitActivePage();
    const { w, h } = await page.mainFrame().evaluate<{ w: number; h: number }>(
      "({ w: window.innerWidth, h: window.innerHeight })",
    );
    return { width: w || 1280, height: h || 720 };
  } catch {
    return { width: 1280, height: 720 };
  }
}

/**
 * Normalize coordinates from Google's 0-1000 range to actual viewport dimensions
 */
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  // Clamp to 0-999 range
  x = Math.min(999, Math.max(0, x));
  y = Math.min(999, Math.max(0, y));

  return {
    x: Math.floor((x / 1000) * viewportWidth),
    y: Math.floor((y / 1000) * viewportHeight),
  };
}

/**
 * Helper to capture screenshot and return standard CUA result
 */
export async function createCuaResult(
  v3: V3,
  success: boolean,
  error?: string,
): Promise<CuaToolResult> {
  try {
    const page = await v3.context.awaitActivePage();
    const screenshotBase64 = await waitAndCaptureScreenshot(page);
    return {
      success,
      url: page.url(),
      error,
      screenshotBase64,
    };
  } catch (e) {
    return {
      success: false,
      error: error || (e as Error).message,
    };
  }
}

/**
 * Standard toModelOutput for CUA tools - returns screenshot as media
 */
export function cuaToModelOutput(result: CuaToolResult): CuaModelOutput {
  const content: ModelOutputContentItem[] = [
    {
      type: "text",
      text: JSON.stringify({
        success: result.success,
        url: result.url,
        ...(result.error ? { error: result.error } : {}),
      }),
    },
  ];

  if (result.screenshotBase64) {
    content.push({
      type: "media",
      mediaType: "image/png",
      data: result.screenshotBase64,
    });
  }

  return { type: "content" as const, value: content };
}

