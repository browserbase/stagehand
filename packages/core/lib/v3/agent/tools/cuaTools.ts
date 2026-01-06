/**
 * Google Computer Use Agent (CUA) Tools
 *
 * These tools match Google's native computer use tool names and signatures.
 * They can be used with V3AgentHandler when using a Google CUA model
 * (e.g., google/gemini-2.5-computer-use-preview-10-2025).
 *
 * Google CUA uses a 0-1000 coordinate system that gets normalized to viewport coordinates.
 */

import { tool, ToolSet } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { ModelOutputContentItem } from "../../types/public/agent";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler";
import { mapKeyToPlaywright } from "../utils/cuaKeyMapping";

interface CuaToolResult {
  success: boolean;
  url?: string;
  error?: string;
  screenshotBase64?: string;
}

/**
 * Get viewport dimensions from the page
 */
async function getViewportSize(
  v3: V3,
): Promise<{ width: number; height: number }> {
  try {
    const page = await v3.context.awaitActivePage();
    const { w, h } = await page.mainFrame().evaluate<{ w: number; h: number }>(
      "({ w: window.innerWidth, h: window.innerHeight })",
    );
    return { width: w || 1280, height: h || 720 };
  } catch {
    return { width: 1280, height: 720 };
  }
}

/**
 * Normalize coordinates from Google's 0-1000 range to actual viewport dimensions
 */
function normalizeGoogleCoordinates(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  // Clamp to 0-999 range
  x = Math.min(999, Math.max(0, x));
  y = Math.min(999, Math.max(0, y));

  return {
    x: Math.floor((x / 1000) * viewportWidth),
    y: Math.floor((y / 1000) * viewportHeight),
  };
}

/**
 * Helper to capture screenshot and return standard CUA result
 */
async function createCuaResult(
  v3: V3,
  success: boolean,
  error?: string,
): Promise<CuaToolResult> {
  try {
    const page = await v3.context.awaitActivePage();
    const screenshotBase64 = await waitAndCaptureScreenshot(page);
    return {
      success,
      url: page.url(),
      error,
      screenshotBase64,
    };
  } catch (e) {
    return {
      success: false,
      error: error || (e as Error).message,
    };
  }
}

/**
 * Standard toModelOutput for CUA tools - returns screenshot as media
 */
function cuaToModelOutput(result: CuaToolResult) {
  const content: ModelOutputContentItem[] = [
    {
      type: "text",
      text: JSON.stringify({
        success: result.success,
        url: result.url,
        ...(result.error ? { error: result.error } : {}),
      }),
    },
  ];

  if (result.screenshotBase64) {
    content.push({
      type: "media",
      mediaType: "image/png",
      data: result.screenshotBase64,
    });
  }

  return { type: "content" as const, value: content };
}

/**
 * click_at - Click at coordinates (Google CUA uses 0-1000 range)
 */
export const clickAtTool = (v3: V3) =>
  tool({
    description: "Click at the specified coordinates",
    inputSchema: z.object({
      x: z.number().describe("X coordinate (0-1000)"),
      y: z.number().describe("Y coordinate (0-1000)"),
      button: z
        .enum(["left", "right", "middle"])
        .optional()
        .describe("Mouse button to click"),
    }),
    execute: async ({ x, y, button = "left" }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const viewport = await getViewportSize(v3);
        const coords = normalizeGoogleCoordinates(
          x,
          y,
          viewport.width,
          viewport.height,
        );

        v3.logger({
          category: "agent",
          message: `CUA click_at: (${x}, ${y}) -> (${coords.x}, ${coords.y})`,
          level: 1,
        });

        await page.click(coords.x, coords.y, { button });
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * type_text_at - Click at coordinates and type text
 */
export const typeTextAtTool = (v3: V3) =>
  tool({
    description: "Click at coordinates and type text",
    inputSchema: z.object({
      x: z.number().describe("X coordinate (0-1000)"),
      y: z.number().describe("Y coordinate (0-1000)"),
      text: z.string().describe("Text to type"),
      press_enter: z
        .boolean()
        .optional()
        .describe("Whether to press Enter after typing"),
      clear_before_typing: z
        .boolean()
        .optional()
        .describe("Whether to clear the field before typing (default: true)"),
    }),
    execute: async ({
      x,
      y,
      text,
      press_enter = false,
      clear_before_typing = true,
    }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const viewport = await getViewportSize(v3);
        const coords = normalizeGoogleCoordinates(
          x,
          y,
          viewport.width,
          viewport.height,
        );

        v3.logger({
          category: "agent",
          message: `CUA type_text_at: (${x}, ${y}) -> "${text.substring(0, 30)}..."`,
          level: 1,
        });

        // Click first
        await page.click(coords.x, coords.y);

        // Clear if requested
        if (clear_before_typing) {
          await page.keyPress("Control+A");
          await page.keyPress("Backspace");
        }

        // Type the text
        await page.type(text);

        // Press enter if requested
        if (press_enter) {
          await page.keyPress("Enter");
        }

        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * key_combination - Press a key combination
 */
export const keyCombinationTool = (v3: V3) =>
  tool({
    description: "Press a key combination (e.g., 'Control+C', 'Enter')",
    inputSchema: z.object({
      keys: z
        .string()
        .describe("Key combination (e.g., 'Control+C', 'Alt+Tab')"),
    }),
    execute: async ({ keys }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        v3.logger({
          category: "agent",
          message: `CUA key_combination: ${keys}`,
          level: 1,
        });

        // Split and map keys
        const keyList = keys
          .split("+")
          .map((key) => key.trim())
          .map((key) => mapKeyToPlaywright(key));
        const combo = keyList.join("+");

        await page.keyPress(combo);
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * scroll_at - Scroll at a specific position
 */
export const scrollAtTool = (v3: V3) =>
  tool({
    description: "Scroll at a specific position",
    inputSchema: z.object({
      x: z.number().describe("X coordinate (0-1000)"),
      y: z.number().describe("Y coordinate (0-1000)"),
      direction: z
        .enum(["up", "down", "left", "right"])
        .describe("Scroll direction"),
      magnitude: z
        .number()
        .optional()
        .describe("Scroll amount in pixels (default: 800)"),
    }),
    execute: async ({
      x,
      y,
      direction,
      magnitude = 800,
    }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const viewport = await getViewportSize(v3);
        const coords = normalizeGoogleCoordinates(
          x,
          y,
          viewport.width,
          viewport.height,
        );

        let scroll_x = 0;
        let scroll_y = 0;
        if (direction === "up") scroll_y = -magnitude;
        else if (direction === "down") scroll_y = magnitude;
        else if (direction === "left") scroll_x = -magnitude;
        else if (direction === "right") scroll_x = magnitude;

        v3.logger({
          category: "agent",
          message: `CUA scroll_at: ${direction} at (${coords.x}, ${coords.y})`,
          level: 1,
        });

        await page.scroll(coords.x, coords.y, scroll_x, scroll_y);
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * scroll_document - Scroll the entire document
 */
export const scrollDocumentTool = (v3: V3) =>
  tool({
    description: "Scroll the entire document up or down",
    inputSchema: z.object({
      direction: z.enum(["up", "down"]).describe("Scroll direction"),
    }),
    execute: async ({ direction }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        v3.logger({
          category: "agent",
          message: `CUA scroll_document: ${direction}`,
          level: 1,
        });

        await page.keyPress(direction === "up" ? "PageUp" : "PageDown");
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * navigate - Navigate to a URL
 */
export const navigateTool = (v3: V3) =>
  tool({
    description: "Navigate to a URL",
    inputSchema: z.object({
      url: z.string().describe("URL to navigate to"),
    }),
    execute: async ({ url }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        v3.logger({
          category: "agent",
          message: `CUA navigate: ${url}`,
          level: 1,
        });

        await page.goto(url, { waitUntil: "load" });
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * go_back - Navigate back
 */
export const goBackTool = (v3: V3) =>
  tool({
    description: "Go back to the previous page",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        v3.logger({
          category: "agent",
          message: "CUA go_back",
          level: 1,
        });

        await page.goBack();
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * go_forward - Navigate forward
 */
export const goForwardTool = (v3: V3) =>
  tool({
    description: "Go forward to the next page",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        v3.logger({
          category: "agent",
          message: "CUA go_forward",
          level: 1,
        });

        await page.goForward();
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * hover_at - Hover at coordinates
 */
export const hoverAtTool = (v3: V3) =>
  tool({
    description: "Hover at the specified coordinates",
    inputSchema: z.object({
      x: z.number().describe("X coordinate (0-1000)"),
      y: z.number().describe("Y coordinate (0-1000)"),
    }),
    execute: async ({ x, y }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const viewport = await getViewportSize(v3);
        const coords = normalizeGoogleCoordinates(
          x,
          y,
          viewport.width,
          viewport.height,
        );

        v3.logger({
          category: "agent",
          message: `CUA hover_at: (${x}, ${y}) -> (${coords.x}, ${coords.y})`,
          level: 1,
        });

        await page.hover(coords.x, coords.y);
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * drag_and_drop - Drag from one point to another
 */
export const dragAndDropTool = (v3: V3) =>
  tool({
    description: "Drag from one point to another",
    inputSchema: z.object({
      x: z.number().describe("Start X coordinate (0-1000)"),
      y: z.number().describe("Start Y coordinate (0-1000)"),
      destination_x: z.number().describe("End X coordinate (0-1000)"),
      destination_y: z.number().describe("End Y coordinate (0-1000)"),
    }),
    execute: async ({
      x,
      y,
      destination_x,
      destination_y,
    }): Promise<CuaToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();
        const viewport = await getViewportSize(v3);
        const startCoords = normalizeGoogleCoordinates(
          x,
          y,
          viewport.width,
          viewport.height,
        );
        const endCoords = normalizeGoogleCoordinates(
          destination_x,
          destination_y,
          viewport.width,
          viewport.height,
        );

        v3.logger({
          category: "agent",
          message: `CUA drag_and_drop: (${startCoords.x}, ${startCoords.y}) -> (${endCoords.x}, ${endCoords.y})`,
          level: 1,
        });

        await page.dragAndDrop(
          startCoords.x,
          startCoords.y,
          endCoords.x,
          endCoords.y,
          { steps: 10, delay: 10 },
        );
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * wait_5_seconds - Wait for 5 seconds
 */
export const wait5SecondsTool = (v3: V3) =>
  tool({
    description: "Wait for 5 seconds",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        v3.logger({
          category: "agent",
          message: "CUA wait_5_seconds",
          level: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 5000));
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * open_web_browser - Browser is already open, this is a no-op but returns screenshot
 */
export const openWebBrowserTool = (v3: V3) =>
  tool({
    description: "Open the web browser (browser is already open)",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        v3.logger({
          category: "agent",
          message: "CUA open_web_browser (no-op, browser already open)",
          level: 1,
        });

        // Browser is already open, just return current state with screenshot
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

/**
 * Creates all Google CUA tools as a ToolSet
 */
export function createGoogleCuaTools(v3: V3): ToolSet {
  return {
    click_at: clickAtTool(v3),
    type_text_at: typeTextAtTool(v3),
    key_combination: keyCombinationTool(v3),
    scroll_at: scrollAtTool(v3),
    scroll_document: scrollDocumentTool(v3),
    navigate: navigateTool(v3),
    go_back: goBackTool(v3),
    go_forward: goForwardTool(v3),
    hover_at: hoverAtTool(v3),
    drag_and_drop: dragAndDropTool(v3),
    wait_5_seconds: wait5SecondsTool(v3),
    open_web_browser: openWebBrowserTool(v3),
  };
}

