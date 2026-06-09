/**
 * Convert Playwright-style modifier key names (Control/Shift/Alt/Meta) into the
 * CDP `Input.dispatchMouseEvent` modifiers bitmask (Alt=1, Control=2, Meta=4,
 * Shift=8). Unknown names contribute nothing. Shared by coordinate-based
 * (`Page`) and selector-based (`Locator`) mouse dispatch.
 */
export function cdpModifierMask(modifiers?: readonly string[]): number {
  if (!modifiers?.length) return 0;
  let mask = 0;
  for (const modifier of modifiers) {
    switch (modifier) {
      case "Alt":
        mask |= 1;
        break;
      case "Control":
        mask |= 2;
        break;
      case "Meta":
        mask |= 4;
        break;
      case "Shift":
        mask |= 8;
        break;
    }
  }
  return mask;
}
