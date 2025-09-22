/**
 * Universal key mapping utility for converting various key representations
 * to Playwright-compatible key names. Used by all CUA clients and handlers.
 */

/**
 * map of key variations to Playwright key names
 * This handles keys from both Anthropic and OpenAI CUA APIs
 */
const KEY_MAP: Record<string, string> = {
  ENTER: "Enter",
  RETURN: "Enter",
  ESCAPE: "Escape",
  ESC: "Escape",
  BACKSPACE: "Backspace",
  TAB: "Tab",
  SPACE: " ",
  DELETE: "Delete",
  DEL: "Delete",
  ARROWUP: "ArrowUp",
  ARROWDOWN: "ArrowDown",
  ARROWLEFT: "ArrowLeft",
  ARROWRIGHT: "ArrowRight",
  ARROW_UP: "ArrowUp",
  ARROW_DOWN: "ArrowDown",
  ARROW_LEFT: "ArrowLeft",
  ARROW_RIGHT: "ArrowRight",
  UP: "ArrowUp",
  DOWN: "ArrowDown",
  LEFT: "ArrowLeft",
  RIGHT: "ArrowRight",
  SHIFT: "Shift",
  CONTROL: "Control",
  CTRL: "Control",
  ALT: "Alt",
  OPTION: "Alt", // macOS alternative name
  META: "Meta",
  COMMAND: "Meta", // macOS
  CMD: "Meta", // macOS shorthand
  SUPER: "Meta", // Linux
  WINDOWS: "Meta", // Windows
  WIN: "Meta", // Windows shorthand
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  PAGE_UP: "PageUp",
  PAGE_DOWN: "PageDown",
  PGUP: "PageUp",
  PGDN: "PageDown",
};

/**
 * Maps a key name from various formats to Playwright-compatible format
 * @param key The key name in any supported format
 * @returns The Playwright-compatible key name
 */
export function mapKeyToPlaywright(key: string): string {
  if (!key) return key;
  const upperKey = key.toUpperCase();
  return KEY_MAP[upperKey] || key;
}
