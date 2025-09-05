import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createActTool = (
  stagehandPage: StagehandPage,
  executionModel?: string,
) =>
  tool({
    description: "Perform an action on the page (click, type)",
    parameters: z.object({
      action: z.string()
        .describe(`Describe what to click, or type within in a short, specific phrase that mentions the element type. 
          Examples:
          - "click the Login button"
          - "click the language dropdown"
          - type "John" into the first name input
          - type "Doe" into the last name input`),
    }),
    execute: async ({ action }) => {
      try {
        let result;
        if (executionModel) {
          result = await stagehandPage.page.act({
            action,
            modelName: executionModel,
          });
        } else {
          result = await stagehandPage.page.act(action);
        }
        const isIframeAction = result.action === "an iframe";

        if (isIframeAction) {
          const fallback = await stagehandPage.page.act(
            executionModel
              ? { action, modelName: executionModel, iframes: true }
              : { action, iframes: true },
          );
          return {
            success: fallback.success,
            action: fallback.action,
            isIframe: true,
          };
        }

        return {
          success: result.success,
          action: result.action,
          isIframe: false,
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
  });
