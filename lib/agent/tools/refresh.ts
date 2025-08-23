import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createRefreshTool = (page: Page) =>
  tool({
    description: "Refresh the current page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're refreshing"),
    }),
    execute: async () => {
      await page.reload();
      return { success: true };
    },
  });
