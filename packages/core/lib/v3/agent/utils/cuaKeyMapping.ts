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

/**
 * Cross-client platform and key normalization helpers used by CUA and tools
 */
export type Platform = "mac" | "windows" | "linux";

export function detectPlatformFromUserAgent(
  userAgent: string,
): Platform | undefined {
  const ua = userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "mac";
  if (ua.includes("windows nt")) return "windows";
  if (ua.includes("linux") || ua.includes("cros")) return "linux";
  return undefined;
}

export function resolvePlatform(
  param: Platform | "auto" | undefined,
  userAgent: string | undefined,
): Platform {
  if (param && param !== "auto") return param;
  const fromUa = userAgent ? detectPlatformFromUserAgent(userAgent) : undefined;
  if (fromUa) return fromUa;
  if (typeof process !== "undefined") {
    if (process.platform === "darwin") return "mac";
    if (process.platform === "win32") return "windows";
  }
  return "linux";
}

export function normalizeKeyToken(raw: string, platform: Platform): string {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (lower === "mod") return platform === "mac" ? "Meta" : "Control";
  if (
    lower === "cmd" ||
    lower === "command" ||
    lower === "meta" ||
    lower === "⌘"
  )
    return "Meta";
  if (lower === "ctrl" || lower === "control") return "Control";
  if (lower === "alt" || lower === "option" || lower === "opt") return "Alt";
  if (lower === "shift") return "Shift";
  if (lower === "enter" || lower === "return") return "Enter";
  if (lower === "esc" || lower === "escape") return "Escape";
  if (lower === "space" || lower === "spacebar") return "Space";
  if (lower === "left" || lower === "arrowleft") return "ArrowLeft";
  if (lower === "right" || lower === "arrowright") return "ArrowRight";
  if (lower === "up" || lower === "arrowup") return "ArrowUp";
  if (lower === "down" || lower === "arrowdown") return "ArrowDown";
  if (lower === "pgup" || lower === "pageup") return "PageUp";
  if (lower === "pgdn" || lower === "pagedown") return "PageDown";
  if (lower === "del" || lower === "delete") return "Delete";
  if (lower === "backspace") return "Backspace";
  if (lower === "tab") return "Tab";
  if (lower === "home") return "Home";
  if (lower === "end") return "End";
  // Upper-case single letters (a -> A), keep others as-is
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  return t;
}

export function normalizeKeys(
  keys: string | string[],
  platform: Platform,
): { combo: string; tokens: string[] } {
  const tokens = Array.isArray(keys)
    ? keys
    : keys
        .split("+")
        .map((k) => k.trim())
        .filter(Boolean);
  const normalizedTokens = tokens.map((k) => normalizeKeyToken(k, platform));
  return { combo: normalizedTokens.join("+"), tokens: normalizedTokens };
}
