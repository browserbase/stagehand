import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createWaitTool = (v3: V3) =>
  tool({
    description: "Wait for a specified time",
    inputSchema: z.object({
      timeMs: z.number().describe("Time in milliseconds"),
    }),
    execute: async ({ timeMs }) => {
      v3.logger({
        category: "agent",
        message: `Agent calling tool: wait`,
        level: 1,
        auxiliary: {
          arguments: {
            value: `Waiting for ${timeMs} milliseconds`,
            type: "string",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, timeMs));
      if (timeMs > 0) {
        v3.recordAgentReplayStep({ type: "wait", timeMs });
      }
      return { success: true, waited: timeMs };
    },
  });
