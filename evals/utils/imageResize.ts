import { Page } from "playwright";

/**
 * Takes a screenshot optimized for evaluator use (smaller size, lower quality)
 * @param page - The Playwright page to screenshot
 * @param scaleFactor - The scale factor (e.g., 0.75 for 25% reduction)
 * @returns Optimized screenshot buffer
 */
export async function takeOptimizedScreenshot(
  page: Page,
  scaleFactor: number = 0.75,
): Promise<Buffer> {
  try {
    // Get current viewport
    const viewport = page.viewportSize();
    if (!viewport) {
      // Take regular screenshot if viewport not available
      return await page.screenshot({ type: "jpeg", quality: 70 });
    }

    // Calculate new dimensions
    const newWidth = Math.round(viewport.width * scaleFactor);
    const newHeight = Math.round(viewport.height * scaleFactor);

    // Set a smaller viewport temporarily
    await page.setViewportSize({ width: newWidth, height: newHeight });

    // Take screenshot with lower quality
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 70, // Lower quality for smaller file size
    });

    // Restore original viewport
    await page.setViewportSize(viewport);

    return screenshot;
  } catch (error) {
    console.warn("Failed to take optimized screenshot:", error);
    // Fallback to regular screenshot with lower quality
    return await page.screenshot({ type: "jpeg", quality: 70 });
  }
}

/**
 * Compresses an existing image buffer (simple quality reduction)
 * @param imageBuffer - The original image buffer
 * @returns Compressed buffer (returns original if compression fails)
 */
export function compressImageBuffer(imageBuffer: Buffer): Buffer {
  // For now, just return the original buffer
  // This is a placeholder for potential future compression
  // The main optimization comes from takeOptimizedScreenshot
  return imageBuffer;
}
