import { tool } from "ai";
import { z } from "zod/v3";
import { Page } from "@/types/page";

export const createNavBackTool = (page: Page) =>
  tool({
    description: "Navigate back to the previous page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're going back"),
    }),
    execute: async () => {
      await page.goBack();
      return { success: true };
    },
  });
