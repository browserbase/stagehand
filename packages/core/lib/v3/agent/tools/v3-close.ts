import { tool } from "ai";
import { z } from "zod/v3";

export const createCloseTool = () =>
  tool({
    description: "Complete the task and close",
    inputSchema: z.object({
      reasoningText: z.string().describe("Summary of what was accomplished"),
      taskComplete: z
        .boolean()
        .describe("Whether the task was completed successfully"),
    }),
    execute: async ({ reasoningText, taskComplete }) => {
      return { success: true, reasoningText, taskComplete };
    },
  });
