import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

type Platform = "mac" | "windows" | "linux";

function detectPlatformFromUserAgent(userAgent: string): Platform | undefined {
  const ua = userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("macintosh")) return "mac";
  if (ua.includes("windows nt")) return "windows";
  if (ua.includes("linux") || ua.includes("cros")) return "linux";
  return undefined;
}

function resolvePlatform(
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

function normalizeKeyToken(raw: string, platform: Platform): string {
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
  if (lower === "home") return "Home";
  if (lower === "end") return "End";
  // Upper-case single letters (a -> A), keep others as-is
  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  return t;
}

function normalizeKeys(
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

export const createKeysTool = (stagehandPage: StagehandPage) =>
  tool({
    description:
      "Send keyboard events: press, down, up, type, or insertText. Supports combinations like mod+a, cmd+c, ctrl+v, etc. 'mod' maps to Command on macOS and Control on Windows/Linux.",
    parameters: z.object({
      method: z
        .enum(["press", "down", "up", "type", "insertText"]) // defaults to press if keys provided
        .describe("Keyboard method to use"),
      keys: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Key or combo for press/down/up. Use '+' to combine, e.g. 'mod+a' or ['Control','A'].",
        ),
      text: z.string().optional().describe("Text for type/insertText methods"),
      delay: z
        .number()
        .optional()
        .describe(
          "Optional delay in ms between events (applies to press/type).",
        ),
      repeat: z
        .number()
        .optional()
        .describe("Repeat count for press/type. Default 1."),
      platform: z
        .enum(["auto", "mac", "windows", "linux"]) // auto detects from UA or process.platform
        .optional()
        .describe(
          "Override platform for 'mod' mapping. Default 'auto' (detect).",
        ),
    }),
    execute: async ({ method, keys, text, delay, repeat, platform }) => {
      const userAgent = await stagehandPage.page.evaluate(
        () => navigator.userAgent,
      );
      const resolvedPlatform = resolvePlatform(platform ?? "auto", userAgent);

      const times = Math.max(1, repeat ?? 1);

      if (method === "type") {
        if (!text) throw new Error("'text' is required for method 'type'");
        for (let i = 0; i < times; i++) {
          await stagehandPage.page.keyboard.type(
            text,
            delay ? { delay } : undefined,
          );
        }
        return { success: true, method, text, times };
      }

      if (method === "insertText") {
        if (!text)
          throw new Error("'text' is required for method 'insertText'");
        for (let i = 0; i < times; i++) {
          await stagehandPage.page.keyboard.insertText(text);
          if (delay) await stagehandPage.page.waitForTimeout(delay);
        }
        return { success: true, method, text, times };
      }

      if (!keys)
        throw new Error("'keys' is required for methods press/down/up");
      const { combo, tokens } = normalizeKeys(keys, resolvedPlatform);

      if (method === "press") {
        for (let i = 0; i < times; i++) {
          await stagehandPage.page.keyboard.press(
            combo,
            delay ? { delay } : undefined,
          );
        }
        return {
          success: true,
          method,
          keys: combo,
          times,
          platform: resolvedPlatform,
        };
      }

      if (method === "down") {
        for (const token of tokens) {
          await stagehandPage.page.keyboard.down(token);
          if (delay) await stagehandPage.page.waitForTimeout(delay);
        }
        return {
          success: true,
          method,
          keys: tokens,
          platform: resolvedPlatform,
        };
      }

      if (method === "up") {
        // Release in reverse order for combos
        for (let i = tokens.length - 1; i >= 0; i--) {
          await stagehandPage.page.keyboard.up(tokens[i]);
          if (delay) await stagehandPage.page.waitForTimeout(delay);
        }
        return {
          success: true,
          method,
          keys: tokens,
          platform: resolvedPlatform,
        };
      }

      throw new Error(`Unsupported method: ${method}`);
    },
  });
