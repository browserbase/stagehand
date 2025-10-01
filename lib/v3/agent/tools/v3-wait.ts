import { tool } from "ai";
import { z } from "zod/v3";
import type { V3 } from "@/lib/v3/v3";

export const createWaitTool = (v3: V3) =>
  tool({
    description: "Wait for a specified time",
    parameters: z.object({
      timeMs: z.number().describe("Time in milliseconds"),
    }),
    execute: async ({ timeMs }) => {
      await new Promise((resolve) => setTimeout(resolve, timeMs));
      if (timeMs > 0) {
        v3.recordAgentReplayStep({ type: "wait", timeMs });
      }
      return { success: true, waited: timeMs };
    },
  });
