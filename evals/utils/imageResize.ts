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
    // Take screenshot first without modifying viewport
    const screenshot = await page.screenshot({ type: "jpeg", quality: 70 });

    // Try to use sharp for resizing if available (optional dependency)
    try {
      const sharpModule = await import("sharp");
      const sharp = sharpModule.default;
      const metadata = await sharp(screenshot).metadata();

      if (metadata.width && metadata.height) {
        const newWidth = Math.round(metadata.width * scaleFactor);
        const newHeight = Math.round(metadata.height * scaleFactor);

        return await sharp(screenshot)
          .resize(newWidth, newHeight)
          .jpeg({ quality: 70 })
          .toBuffer();
      }
    } catch (sharpError) {
      // Sharp not available or failed, return original screenshot
      console.debug("Sharp not available for image resizing:", sharpError);
    }

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
