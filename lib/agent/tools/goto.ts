import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createGotoTool = (page: Page) =>
  tool({
    description: "Navigate to a specific URL",
    parameters: z.object({
      url: z.string().describe("The URL to navigate to"),
    }),
    execute: async ({ url }) => {
      await page.goto(url, { waitUntil: "load" });
      return { success: true, url };
    },
  });
