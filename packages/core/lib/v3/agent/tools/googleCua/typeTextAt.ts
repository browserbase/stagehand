import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./types.js";
import {
  getViewportSize,
  normalizeGoogleCoordinates,
  createCuaResult,
  cuaToModelOutput,
} from "./utils.js";

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
          message: `CUA type_text_at: (${x}, ${y}) -> "${text.substring(0, 30)}${text.length > 30 ? "..." : ""}"`,
          level: 1,
        });

        await page.click(coords.x, coords.y);

        if (clear_before_typing) {
          await page.keyPress("Control+A");
          await page.keyPress("Backspace");
        }

        await page.type(text);

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
