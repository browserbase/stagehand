import { tool } from "ai";
import { z } from "zod";
import { Page } from "@/types/page";

export const createActTool = (page: Page, executionModel?: string) =>
  tool({
    description: "Perform an action on the page (click, type, etc)",
    parameters: z.object({
      parameters: z.string()
        .describe(`Describe what to click in a short, specific phrase that mentions the element type. 
          Examples:
          - "click the Login button"
          - "click the language dropdown"
          - type "John" into the first name input
          - type "Doe" into the last name input`),
    }),
    execute: async ({ parameters }) => {
      const [observeResult] = executionModel
        ? await page.observe({
            instruction: parameters,
            modelName: executionModel,
          })
        : await page.observe(parameters);
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
