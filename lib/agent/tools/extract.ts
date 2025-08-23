import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createExtractTool = (page: Page) =>
  tool({
    description: "Extract data from the page",
    parameters: z.object({
      reasoning: z.string().describe("Why you're extracting this data"),
      parameters: z
        .string()
        .nullable()
        .describe("What to extract, or null for all text"),
    }),
    execute: async ({ parameters }) => {
      if (!parameters) {
        const result = await page.extract();
        return { success: true, data: result.page_text };
      } else {
        const result = await page.extract(parameters);
        return { success: true, data: result };
      }
    },
  });
