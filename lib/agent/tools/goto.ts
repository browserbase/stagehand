import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createGotoTool = (stagehandPage: StagehandPage) =>
  tool({
    description: "Navigate to a specific URL",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      try {
        await stagehandPage.page.goto(url, { waitUntil: "load" });
        return { success: true, url };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
