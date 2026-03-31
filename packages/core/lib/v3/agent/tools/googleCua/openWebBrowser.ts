import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3.js";
import type { CuaToolResult } from "./types.js";
import { createCuaResult, cuaToModelOutput } from "./utils.js";

export const openWebBrowserTool = (v3: V3) =>
  tool({
    description: "Open the web browser (browser is already open)",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        v3.logger({
          category: "agent",
          message: "CUA open_web_browser (no-op, browser already open)",
          level: 1,
        });

        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });
