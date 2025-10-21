import { tool } from "ai";
import { z } from "zod/v3";

export const createCloseTool = () =>
  tool({
    description: "Complete the task and close",
    inputSchema: z.object({
      reasoning: z.string().describe("Summary of what was accomplished"),
      taskComplete: z
        .boolean()
        .describe("Whether the task was completed successfully"),
    }),
    execute: async ({ reasoning, taskComplete }) => {
      return { success: true, reasoning, taskComplete };
    },
  });
