import { tool } from "ai";
import { z } from "zod";

export const createWaitTool = () => {
  return tool({
    description:
      "Wait for a specified duration. Use this after actions that might cause navigation or when you need to allow time for elements to load.",
    parameters: z.object({
      seconds: z
        .number()
        .min(0.5)
        .max(10)
        .default(2)
        .describe("Duration to wait in seconds (0.5 to 10)"),
    }),
    execute: async ({ seconds }: { seconds: number }) => {
      const actualSeconds = Math.min(Math.max(seconds, 0.5), 10);

      await new Promise((resolve) => setTimeout(resolve, actualSeconds * 1000));

      return {
        waited: actualSeconds,
        message: `Waited for ${actualSeconds} seconds`,
      };
    },
  });
};
