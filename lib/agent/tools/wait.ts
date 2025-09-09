import { tool } from "ai";
import { z } from "zod/v3";

export const createWaitTool = () =>
  tool({
    description: "Wait for a specified time",
    parameters: z.object({
      timeMs: z.number().describe("Time to wait in milliseconds"),
    }),
    execute: async ({ timeMs }) => {
      await new Promise((resolve) => setTimeout(resolve, timeMs));
      return { success: true, waited: timeMs };
    },
  });
