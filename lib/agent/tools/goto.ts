import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createGotoTool = (page: Page) =>
  tool({
    description: "Navigate to a specific URL",
    parameters: z.object({
      reasoning: z.string().describe("Why you're navigating to this URL"),
      parameters: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ parameters }) => {
      await page.goto(parameters, { waitUntil: "load" });
      return { success: true, url: parameters };
    },
  });
