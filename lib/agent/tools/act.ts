import { tool } from "ai";
import { z } from "zod/v3";
import { Page } from "@/types/page";

export const createActTool = (page: Page, executionModel?: string) =>
  tool({
    description: "Perform an action on the page (click, type, etc)",
    parameters: z.object({
      action: z.string()
        .describe(`Describe what to click in a short, specific phrase that mentions the element type. 
          Examples:
          - "click the Login button"
          - "click the language dropdown"
          - type "John" into the first name input
          - type "Doe" into the last name input`),
    }),
    execute: async ({ action }) => {
      try {
        const [observeResult] = executionModel
          ? await page.observe({
              instruction: action,
              modelName: executionModel,
            })
          : await page.observe(action);
        if (observeResult) {
          const isIframe = observeResult.description === "an iframe";
          const actOptions = {
            action: action,
            iframes: isIframe,
            ...(executionModel && { modelName: executionModel }),
          };
          await page.act(actOptions);
          return { success: true, action: action };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: "Could not find element" };
    },
  });
