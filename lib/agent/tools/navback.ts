import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createNavBackTool = (stagehand: Stagehand) =>
  tool({
    description: "Navigate back to the previous page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
      try {
        await stagehand.page.goBack();
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
