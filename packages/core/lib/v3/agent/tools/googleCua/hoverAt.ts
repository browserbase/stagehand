/**
 * hover_at - Hover at coordinates
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

