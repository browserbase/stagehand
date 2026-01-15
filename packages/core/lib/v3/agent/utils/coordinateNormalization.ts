import type { Page } from "../../understudy/page";

const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

export type Viewport = { width: number; height: number };

/**
 * Per-page screenshot dimensions cache.
 * Queried once per page, then cached.
 */
const screenshotDimsCache = new WeakMap<Page, Viewport>();

/**
 * Get the screenshot dimensions to use for coordinate normalization.
 * 
 * Strategy:
 * - Check if innerWidth matches clientWidth (indicates normal mode vs advancedStealth)
 * - In normal mode: use innerWidth/Height (unclipped may include browser chrome)
 * - In stealth mode: use unclipped screenshot dims (matches spoofed content area)
 * 
 * Cached per-page after first call.
 */
async function getScreenshotDimensions(page: Page): Promise<Viewport> {
  const cached = screenshotDimsCache.get(page);
  if (cached) {
    return cached;
  }

  try {
    // Get viewport metrics to detect stealth mode
    const metrics = await page.mainFrame().evaluate<{
      innerW: number;
      innerH: number;
      clientW: number;
      clientH: number;
    }>(`({
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      clientW: document.documentElement.clientWidth,
      clientH: document.documentElement.clientHeight,
    })`);

    // Detect if advancedStealth is active by checking if inner != client
    // (stealth spoofs clientWidth/Height to different values)
    const isStealthMode = 
      metrics.innerW !== metrics.clientW || 
      metrics.innerH !== metrics.clientH;

    let dims: Viewport;

    if (isStealthMode) {
      // Stealth mode: use unclipped screenshot dimensions
      // The natural capture matches the spoofed content area
      const buffer = await page.screenshot({ fullPage: false });
      if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
        dims = {
          width: buffer.readUInt32BE(16),
          height: buffer.readUInt32BE(20),
        };
      } else {
        dims = DEFAULT_VIEWPORT;
      }
      console.log(`[COORD] Stealth mode - using unclipped: ${dims.width}x${dims.height}`);
    } else {
      // Normal mode: use innerWidth/Height
      // Unclipped may include browser chrome, so we use the viewport dimensions
      dims = { width: metrics.innerW, height: metrics.innerH };
      console.log(`[COORD] Normal mode - using innerW/H: ${dims.width}x${dims.height}`);
    }

    screenshotDimsCache.set(page, dims);
    return dims;
  } catch {
    console.log(`[COORD] Using DEFAULT_VIEWPORT: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`);
    return DEFAULT_VIEWPORT;
  }
}

export function isGoogleProvider(provider?: string): boolean {
  if (!provider) return false;
  return provider.toLowerCase().includes("google");
}

// Google returns coordinates in a 0-1000 range, we need to normalize
// them to the actual screenshot dimensions
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
  dimensions: Viewport,
): { x: number; y: number } {
  const clampedX = Math.min(999, Math.max(0, x));
  const clampedY = Math.min(999, Math.max(0, y));
  return {
    x: Math.floor((clampedX / 1000) * dimensions.width),
    y: Math.floor((clampedY / 1000) * dimensions.height),
  };
}

/**
 * Process coordinates, normalizing Google's 0-1000 range to pixel coordinates.
 * Uses the actual screenshot dimensions to ensure we click where Google thinks we should.
 */
export async function processCoordinates(
  x: number,
  y: number,
  provider?: string,
  page?: Page,
): Promise<{ x: number; y: number }> {
  if (isGoogleProvider(provider) && page) {
    const dimensions = await getScreenshotDimensions(page);
    const result = normalizeGoogleCoordinates(x, y, dimensions);
    console.log(
      `[COORD DEBUG] Google coords (${x}, ${y}) -> screenshot ${dimensions.width}x${dimensions.height} -> pixel (${result.x}, ${result.y})`,
    );
    return result;
  }
  return { x, y };
}
