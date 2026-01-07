/**
 * drag_and_drop - Drag from one point to another
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

