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
