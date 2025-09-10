import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createNavBackTool = (stagehandPage: StagehandPage) =>
  tool({
    description: "Navigate back to the previous page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
      await stagehandPage.page.goBack();
      return { success: true };
    },
  });
