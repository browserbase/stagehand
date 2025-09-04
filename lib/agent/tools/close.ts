import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createCloseTool = (stagehandPage: StagehandPage) =>
  tool({
    description: "Complete the task and close",
    parameters: z.object({
      reasoning: z.string().describe("Summary of what was accomplished"),
      taskComplete: z
        .boolean()
        .describe("Whether the task was completed successfully"),
    }),
    execute: async ({ reasoning, taskComplete }) => {
      await stagehandPage.page.close();
      return { success: true, reasoning, taskComplete };
    },
  });
