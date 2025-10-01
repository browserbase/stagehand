import { tool } from "ai";
import { z } from "zod/v3";

export const createCloseTool = () =>
  tool({
    description: "Complete the task and close",
    parameters: z.object({
      reasoning: z.string().describe("Summary of what was accomplished"),
      success: z
        .boolean()
        .describe("Whether the full goal of the task was a success or not"),
    }),
    execute: async ({ reasoning, success }) => {
      return { success, reasoning };
    },
  });
