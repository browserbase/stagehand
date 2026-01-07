/**
 * key_combination - Press a key combination
 */

import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3";
import type { CuaToolResult } from "./types";
import { createCuaResult, cuaToModelOutput } from "./utils";
import { mapKeyToPlaywright } from "../../utils/cuaKeyMapping";

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

