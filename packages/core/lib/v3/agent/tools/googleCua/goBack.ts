import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./types.js";
import { createCuaResult, cuaToModelOutput } from "./utils.js";

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
