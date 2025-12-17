const DEFAULT_VIEWPORT = { width: 1288, height: 711 };

export function isGoogleProvider(provider?: string): boolean {
  if (!provider) return false;
  return provider.toLowerCase().includes("google");
}
//google returns coordinates in a 0-1000 range, we need to normalize
// them to the viewport dimensions
export function normalizeGoogleCoordinates(
  x: number,
  y: number,
): { x: number; y: number } {
  const clampedX = Math.min(999, Math.max(0, x));
  const clampedY = Math.min(999, Math.max(0, y));
  return {
    x: Math.floor((clampedX / 1000) * DEFAULT_VIEWPORT.width),
    y: Math.floor((clampedY / 1000) * DEFAULT_VIEWPORT.height),
  };
}

export function processCoordinates(
  x: number,
  y: number,
  provider?: string,
): { x: number; y: number } {
  if (isGoogleProvider(provider)) {
    return normalizeGoogleCoordinates(x, y);
  }
  return { x, y };
}
