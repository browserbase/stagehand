import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./types.js";
import { createCuaResult, cuaToModelOutput } from "./utils.js";

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
