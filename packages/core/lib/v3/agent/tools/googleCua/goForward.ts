import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./types.js";
import { createCuaResult, cuaToModelOutput } from "./utils.js";

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
