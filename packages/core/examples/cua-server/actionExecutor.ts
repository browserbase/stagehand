import type { Page } from "@browserbasehq/stagehand";
import { ActionRequest, ActionExecutionResult } from "./types";

/**
 * Key mapping for converting various key representations to Playwright-compatible names
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
  OPTION: "Alt",
  META: "Meta",
  COMMAND: "Meta",
  CMD: "Meta",
  SUPER: "Meta",
  WINDOWS: "Meta",
  WIN: "Meta",
  HOME: "Home",
  END: "End",
  PAGEUP: "PageUp",
  PAGEDOWN: "PageDown",
  PAGE_UP: "PageUp",
  PAGE_DOWN: "PageDown",
  PGUP: "PageUp",
  PGDN: "PageDown",
};

function mapKeyToPlaywright(key: string): string {
  if (!key) return key;
  const upperKey = key.toUpperCase();
  return KEY_MAP[upperKey] || key;
}

/**
 * ActionExecutor
 *
 * Executes CUA browser primitives on a Page object.
 * Adapted from V3CuaAgentHandler.executeAction logic.
 */
export async function executeAction(
  page: Page,
  action: ActionRequest,
): Promise<ActionExecutionResult> {
  try {
    switch (action.type) {
      case "click": {
        const { x, y, button = "left", clickCount = 1 } = action;
        if (typeof x !== "number" || typeof y !== "number") {
          return {
            success: false,
            error: "click requires x and y coordinates",
          };
        }
        await page.click(x, y, {
          button: button as "left" | "right" | "middle",
          clickCount,
        });
        return { success: true };
      }

      case "double_click":
      case "doubleClick": {
        const { x, y } = action;
        if (typeof x !== "number" || typeof y !== "number") {
          return {
            success: false,
            error: "double_click requires x and y coordinates",
          };
        }
        await page.click(x, y, {
          button: "left",
          clickCount: 2,
        });
        return { success: true };
      }

      case "tripleClick": {
        const { x, y } = action;
        if (typeof x !== "number" || typeof y !== "number") {
          return {
            success: false,
            error: "tripleClick requires x and y coordinates",
          };
        }
        await page.click(x, y, {
          button: "left",
          clickCount: 3,
        });
        return { success: true };
      }

      case "type": {
        const { text } = action;
        if (typeof text !== "string") {
          return { success: false, error: "type requires text parameter" };
        }
        await page.type(text);
        return { success: true };
      }

      case "keypress": {
        const { keys } = action;
        if (!keys) {
          return { success: false, error: "keypress requires keys parameter" };
        }
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const rawKey of keyList) {
          const mapped = mapKeyToPlaywright(String(rawKey));
          await page.keyPress(mapped);
        }
        return { success: true };
      }

      case "scroll": {
        const { x = 0, y = 0, scroll_x = 0, scroll_y = 0 } = action;
        await page.scroll(
          x as number,
          y as number,
          scroll_x as number,
          scroll_y as number,
        );
        return { success: true };
      }

      case "drag": {
        const { path } = action;
        if (!Array.isArray(path) || path.length < 2) {
          return {
            success: false,
            error: "drag requires path array with at least 2 points",
          };
        }
        const start = path[0];
        const end = path[path.length - 1];
        await page.dragAndDrop(start.x, start.y, end.x, end.y, {
          steps: Math.min(20, Math.max(5, path.length)),
          delay: 10,
        });
        return { success: true };
      }

      case "move": {
        // No direct cursor-only move in the Page API
        // This is a no-op similar to V3CuaAgentHandler
        return { success: true };
      }

      case "wait": {
        const time = action.timeMs ?? 1000;
        await new Promise((r) => setTimeout(r, time));
        return { success: true };
      }

      case "screenshot": {
        // Screenshot is handled separately in state capture
        // This is a no-op as the response always includes a screenshot
        return { success: true };
      }

      case "goto": {
        const { url } = action;
        if (typeof url !== "string") {
          return { success: false, error: "goto requires url parameter" };
        }
        await page.goto(url, { waitUntil: "load" });
        return { success: true };
      }

      case "back": {
        await page.goBack();
        return { success: true };
      }

      case "forward": {
        await page.goForward();
        return { success: true };
      }

      default:
        return {
          success: false,
          error: `Unknown action type: ${action.type}`,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}
