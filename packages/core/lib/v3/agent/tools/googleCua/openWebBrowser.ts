/**
 * open_web_browser - Browser is already open, this is a no-op but returns screenshot
 */

import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3";
import type { CuaToolResult } from "./types";
import { createCuaResult, cuaToModelOutput } from "./utils";

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

        // Browser is already open, just return current state with screenshot
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

