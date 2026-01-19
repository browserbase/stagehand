const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

export interface Viewport {
  width: number;
  height: number;
}

export function isGoogleProvider(provider?: string): boolean {
  if (!provider) return false;
  return provider.toLowerCase().includes("google");
}

// Google returns coordinates in a 0-1000 range, we need to normalize
// them to the viewport dimensions
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
  viewport?: Viewport,
): { x: number; y: number } {
  const vp = viewport ?? DEFAULT_VIEWPORT;
  const clampedX = Math.min(999, Math.max(0, x));
  const clampedY = Math.min(999, Math.max(0, y));
  return {
    x: Math.floor((clampedX / 1000) * vp.width),
    y: Math.floor((clampedY / 1000) * vp.height),
  };
}

export function processCoordinates(
  x: number,
  y: number,
  provider?: string,
  viewport?: Viewport,
): { x: number; y: number } {
  if (isGoogleProvider(provider)) {
    return normalizeGoogleCoordinates(x, y, viewport);
  }
  return { x, y };
}
