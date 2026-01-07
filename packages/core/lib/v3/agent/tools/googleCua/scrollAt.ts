/**
 * scroll_at - Scroll at a specific position
 */

import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3";
import type { CuaToolResult } from "./types";
import {
  getViewportSize,
  normalizeGoogleCoordinates,
  createCuaResult,
  cuaToModelOutput,
} from "./utils";

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

