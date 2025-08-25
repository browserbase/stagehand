import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createActTool = (page: Page) =>
  tool({
    description: "Perform an action on the page (click, type, etc)",
    parameters: z.object({
      parameters: z.string().describe("Description of the action to perform"),
    }),
    execute: async ({ parameters }) => {
      const [observeResult] = await page.observe({
        modelName: "google/gemini-2.5-flash",
        instruction: parameters,
      });
      if (observeResult) {
        const isIframe = observeResult.description === "an iframe";
        if (isIframe) {
          return {
            success: false,
            error: "Iframe encountered",
          };
        }

        await page.act(observeResult);
        return { success: true, action: parameters, observeResult } as const;
      }
      return { success: false, error: "Could not find element" };
    },
  });
