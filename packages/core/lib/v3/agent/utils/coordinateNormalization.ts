import type { V3 } from "../../v3.js";

export function isGoogleProvider(provider?: string): boolean {
  if (!provider) return false;
  return provider.toLowerCase().includes("google");
}

// Google returns coordinates in a 0-1000 range, we need to normalize
// them to the viewport dimensions
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const clampedX = Math.min(999, Math.max(0, x));
  const clampedY = Math.min(999, Math.max(0, y));
  return {
    x: Math.floor((clampedX / 1000) * viewport.width),
    y: Math.floor((clampedY / 1000) * viewport.height),
  };
}

export async function processCoordinates(
  x: number,
  y: number,
  provider?: string,
  v3?: V3,
  resolvedViewport?: { width: number; height: number },
): Promise<{ x: number; y: number }> {
  if (isGoogleProvider(provider)) {
    const viewport =
      resolvedViewport ?? (v3 ? await v3.resolveViewport() : undefined);
    if (viewport) return normalizeGoogleCoordinates(x, y, viewport);
  }
  return { x, y };
}
