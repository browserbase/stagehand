import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createActTool = (page: Page) =>
  tool({
    description: "Perform an action on the page (click, type, etc)",
    parameters: z.object({
      reasoning: z.string().describe("Why you're performing this action"),
      parameters: z.string().describe("Description of the action to perform"),
    }),
    execute: async ({ parameters }) => {
      const [observeResult] = await page.observe(parameters);
      if (observeResult) {
        await page.act(observeResult);
        return { success: true, action: parameters };
      }
      return { success: false, error: "Could not find element" };
    },
  });
