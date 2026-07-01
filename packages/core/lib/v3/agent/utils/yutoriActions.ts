/**
 * Helpers for the Yutori Navigator n1.5 computer-use model.
 *
 * Ported from the Yutori Python SDK (`yutori.navigator`) so the TypeScript
 * client behaves identically to the reference agent loop:
 * - lowercase key-expression mapping (combos with `+`, sequences with spaces)
 * - 1000x1000 normalized coordinate space -> viewport pixels
 * - request payload trimming (drop old screenshots to stay under the size cap)
 * - stop-and-summarize prompt for graceful max-steps termination
 * - task user-context block (location / timezone / current date)
 *
 * @see https://docs.yutori.com/reference/n1-5.md
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Navigator emits coordinates in a normalized 1000x1000 space.
export const NAVIGATOR_COORDINATE_SCALE = 1000;

// Payload management defaults (match yutori.navigator.payload).
export const DEFAULT_MAX_REQUEST_BYTES = 9_500_000;
export const DEFAULT_KEEP_RECENT_SCREENSHOTS = 6;

/**
 * Navigator n1.5 lowercase key names -> Playwright key names.
 * Mirrors yutori.navigator.keys._KEY_MAP.
 */
const KEY_MAP: Record<string, string> = {
  // Modifier keys
  ctrl: "Control",
  control: "Control",
  cmd: "Meta",
  command: "Meta",
  meta: "Meta",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  super: "Meta",
  // Enter keys
  enter: "Enter",
  return: "Enter",
  kp_enter: "Enter",
  // Navigation keys
  tab: "Tab",
  delete: "Delete",
  backspace: "Backspace",
  escape: "Escape",
  esc: "Escape",
  space: " ",
  // Arrow keys
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  // Page navigation
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  // Word-form punctuation
  plus: "+",
  minus: "-",
  equal: "=",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  backquote: "`",
  bracketleft: "[",
  bracketright: "]",
  // Lock keys
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  // Media / misc keys
  pause: "Pause",
  insert: "Insert",
  printscreen: "PrintScreen",
  // Function keys F1..F12
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`]),
  ),
  // Numpad keys
  ...Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`numpad${i}`, String(i)]),
  ),
  numpadmultiply: "*",
  numpadadd: "+",
  numpadsubtract: "-",
  numpaddecimal: ".",
  numpaddivide: "/",
};

function mapSingleKey(key: string): string {
  return KEY_MAP[key.toLowerCase().trim()] ?? key;
}

/**
 * Split a key expression into one token list per sequential press.
 * Spaces separate sequential presses; `+` separates simultaneous tokens.
 */
function splitIntoCombos(keyExpr: string): string[][] {
  return keyExpr
    .trim()
    .split(" ")
    .filter((part) => part.length > 0)
    .map((part) => part.split("+"));
}

/**
 * Convert a Navigator n1.5 key expression to a list of Playwright key-press
 * strings (combos joined with `+`, one entry per sequential press).
 *
 *   "ctrl+c"          -> ["Control+c"]
 *   "down down enter"  -> ["ArrowDown", "ArrowDown", "Enter"]
 */
export function mapNavigatorKeyToPlaywright(keyExpr: string): string[] {
  return splitIntoCombos(keyExpr).map((tokens) =>
    tokens.map(mapSingleKey).join("+"),
  );
}

/**
 * Convert normalized [x, y] (0..scale) to viewport pixels, clamped to the
 * viewport. Mirrors yutori.navigator.coordinates.denormalize_coordinates.
 *
 * Navigator emits coordinates in the normalized 0..scale space, so this
 * mapping is independent of the screenshot's pixel resolution: a HiDPI
 * (devicePixelRatio > 1) capture scales width and height uniformly, and the
 * normalized point still maps proportionally onto the CSS viewport used for
 * clicks. `width`/`height` must therefore be CSS pixels (innerWidth/Height).
 */
export function denormalizeCoordinates(
  coordinates: readonly number[],
  width: number,
  height: number,
  scale: number = NAVIGATOR_COORDINATE_SCALE,
): { x: number; y: number } {
  // Validate up front (matching the Python SDK) so malformed model output
  // surfaces as a clear, recoverable error instead of letting NaN flow into
  // page.click and dispatching a mouse event at an undefined location.
  if (coordinates.length !== 2) {
    throw new Error(
      `Expected [x, y] coordinates, got ${coordinates.length} value(s)`,
    );
  }
  const [nx, ny] = coordinates;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    throw new Error(`Coordinates must be finite numbers, got [${nx}, ${ny}]`);
  }
  if (width <= 0 || height <= 0) {
    throw new Error(
      `Viewport dimensions must be positive, got ${width}x${height}`,
    );
  }
  const rawX = Math.round((nx / scale) * width);
  const rawY = Math.round((ny / scale) * height);
  return {
    x: Math.max(0, Math.min(width - 1, rawX)),
    y: Math.max(0, Math.min(height - 1, rawY)),
  };
}

/**
 * Build a stop-and-summarize user message. Sent (with a final screenshot)
 * after the last tool response so the model produces a text summary rather
 * than returning nothing on max steps.
 * Mirrors yutori.navigator.stop.format_stop_and_summarize.
 */
export function formatStopAndSummarize(task: string): string {
  return (
    `Stop here. ` +
    `Summarize your current progress and list in detail all the findings ` +
    `relevant to the given task:\n${task}\n` +
    `Provide URLs for all relevant results you find and return them in your response. ` +
    `If there is no specific URL for a result, ` +
    `cite the page URL that the information was found on.`
  );
}

/**
 * Append a user-context block (location, timezone, current date/time) to a
 * task string. Mirrors yutori.navigator.context.format_task_with_context.
 * Navigator was trained with this block, so matching the format helps.
 */
export function formatTaskWithContext(
  task: string,
  userTimezone = "America/Los_Angeles",
  userLocation = "San Francisco, CA, US",
): string {
  let tz = userTimezone;
  let parts: Intl.DateTimeFormatPart[];
  const fmt = (timeZone: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
      hour12: false,
    }).formatToParts(new Date());
  try {
    parts = fmt(userTimezone);
  } catch {
    tz = "America/Los_Angeles";
    try {
      parts = fmt(tz);
    } catch {
      tz = "UTC";
      parts = fmt(tz);
    }
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("month")} ${get("day")}, ${get("year")}`;
  const time = `${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
  const context = [
    `User's location: ${userLocation}`,
    `User's timezone: ${tz}`,
    `Current Date: ${date}`,
    `Current Time: ${time}`,
    `Today is: ${get("weekday")}`,
  ].join("\n");
  return `${task}\n\n${context}`;
}

// ---------------------------------------------------------------------------
// Payload trimming (port of yutori.navigator.payload)
// ---------------------------------------------------------------------------

type ContentPart = { type: string; [key: string]: unknown };
type TrimMessage = { role: string; content?: unknown; [key: string]: unknown };

export function estimateMessagesSizeBytes(
  messages: ChatCompletionMessageParam[],
): number {
  // Byte length of the compact JSON serialization (UTF-8).
  return Buffer.byteLength(JSON.stringify(messages), "utf-8");
}

function messageHasImage(message: TrimMessage): boolean {
  return (
    Array.isArray(message.content) &&
    message.content.some(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        (part as ContentPart).type === "image_url",
    )
  );
}

function stripOneImage(message: TrimMessage): boolean {
  if (!Array.isArray(message.content)) return false;
  let removed = false;
  const newContent: unknown[] = [];
  for (const part of message.content) {
    if (
      !removed &&
      typeof part === "object" &&
      part !== null &&
      (part as ContentPart).type === "image_url"
    ) {
      removed = true;
      continue;
    }
    newContent.push(part);
  }
  if (!removed) return false;
  const hasText = newContent.some(
    (p) =>
      typeof p === "object" && p !== null && (p as ContentPart).type === "text",
  );
  if (!hasText) {
    newContent.push({
      type: "text",
      text: "Screenshot omitted to stay under request size limit.",
    });
  }
  message.content = newContent;
  return true;
}

/**
 * Remove old screenshots in place until the payload fits within `maxBytes`.
 * The most recent `keepRecent` screenshots are protected (the very last is
 * always kept). Mirrors yutori.navigator.payload.trim_images_to_fit.
 */
export function trimImagesToFit(
  messages: ChatCompletionMessageParam[],
  maxBytes: number = DEFAULT_MAX_REQUEST_BYTES,
  keepRecent: number = DEFAULT_KEEP_RECENT_SCREENSHOTS,
): { sizeBytes: number; removed: number } {
  let sizeBytes = estimateMessagesSizeBytes(messages);
  if (sizeBytes <= maxBytes) return { sizeBytes, removed: 0 };

  const list = messages as unknown as TrimMessage[];
  const imageIndices: number[] = [];
  list.forEach((msg, i) => {
    if (messageHasImage(msg)) imageIndices.push(i);
  });
  if (imageIndices.length === 0) return { sizeBytes, removed: 0 };

  keepRecent = Math.max(1, keepRecent);
  const protectedIdx = new Set(imageIndices.slice(-keepRecent));

  const stripUntilFits = (skip: (idx: number) => boolean): number => {
    let count = 0;
    for (const idx of imageIndices) {
      if (sizeBytes <= maxBytes) break;
      if (skip(idx)) continue;
      if (stripOneImage(list[idx])) {
        count += 1;
        sizeBytes = estimateMessagesSizeBytes(messages);
      }
    }
    return count;
  };

  // Phase 1: remove images outside the protected window.
  let removed = stripUntilFits((idx) => protectedIdx.has(idx));

  // Phase 2: if still over the limit, remove from protected set (keep latest).
  if (sizeBytes > maxBytes) {
    const lastIdx = imageIndices[imageIndices.length - 1];
    removed += stripUntilFits((idx) => idx === lastIdx);
  }

  return { sizeBytes, removed };
}
