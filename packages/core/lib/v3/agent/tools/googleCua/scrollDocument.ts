/**
 * scroll_document - Scroll the entire document
 */

import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3";
import type { CuaToolResult } from "./types";
import { createCuaResult, cuaToModelOutput } from "./utils";

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

