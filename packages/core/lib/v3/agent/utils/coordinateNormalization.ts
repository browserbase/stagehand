const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

export type ViewportSize = { width: number; height: number };

export function isGoogleProvider(provider?: string): boolean {
  if (!provider) return false;
  return provider.toLowerCase().includes("google");
}
// Google returns coordinates in a 0-1000 range, we need to normalize
// them to the actual viewport dimensions
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
  viewport?: ViewportSize,
): { x: number; y: number } {
  const clampedX = Math.min(999, Math.max(0, x));
  const clampedY = Math.min(999, Math.max(0, y));
  const targetViewport = viewport ?? DEFAULT_VIEWPORT;
  return {
    x: Math.floor((clampedX / 1000) * targetViewport.width),
    y: Math.floor((clampedY / 1000) * targetViewport.height),
  };
}

export function processCoordinates(
  x: number,
  y: number,
  provider?: string,
  viewport?: ViewportSize,
): { x: number; y: number } {
  if (isGoogleProvider(provider)) {
    return normalizeGoogleCoordinates(x, y, viewport);
  }
  return { x, y };
}
