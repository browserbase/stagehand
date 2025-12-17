import { tool } from "ai";
import { z } from "zod";

export const thinkTool = () =>
  tool({
    description: `Use this tool to think through complex problems or plan a sequence of steps. This is for internal reasoning only and doesn't perform any actions. Use this to:

1. Plan a multi-step approach before taking action
2. Break down complex tasks
3. Reason through edge cases
4. Evaluate options when you're unsure what to do next

The output is only visible to you; use it to track your own reasoning process.`,
    inputSchema: z.object({
      reasoning: z
        .string()
        .describe(
          "Your step-by-step reasoning or planning process. Be as detailed as needed.",
        ),
    }),
    execute: async ({ reasoning }) => {
      return {
        acknowledged: true,
        message: reasoning,
      };
    },
  });
