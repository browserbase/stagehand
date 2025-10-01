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
      stagehand.logger({
        category: "agent",
        message: `Agent calling tool: navback`,
        level: 1,
      });
      await stagehand.page.goBack();
      return { success: true };
    },
  });
