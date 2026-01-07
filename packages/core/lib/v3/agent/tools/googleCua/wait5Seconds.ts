/**
 * wait_5_seconds - Wait for 5 seconds
 */

import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../../v3";
import type { CuaToolResult } from "./types";
import { createCuaResult, cuaToModelOutput } from "./utils";

export const wait5SecondsTool = (v3: V3) =>
  tool({
    description: "Wait for 5 seconds",
    inputSchema: z.object({}),
    execute: async (): Promise<CuaToolResult> => {
      try {
        v3.logger({
          category: "agent",
          message: "CUA wait_5_seconds",
          level: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 5000));
        return createCuaResult(v3, true);
      } catch (error) {
        return createCuaResult(v3, false, (error as Error).message);
      }
    },
    toModelOutput: cuaToModelOutput,
  });

