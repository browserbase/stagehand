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
        const observeOptions = executionModel
          ? { instruction: action, modelName: executionModel }
          : { instruction: action };

        const observeResults = await stagehandPage.page.observe(observeOptions);

        if (!observeResults || observeResults.length === 0) {
          return {
            success: false,
            error: "No observable actions found for the given instruction",
          };
        }

        const observeResult = observeResults[0];

        let result;
        if (executionModel) {
          result = await stagehandPage.page.act({
            action,
            modelName: executionModel,
          });
        } else {
          result = await stagehandPage.page.act(observeResult);
        }

        const isIframeAction = result.action === "an iframe";

        if (isIframeAction) {
          // For iframe actions, we need to observe again with iframes: true to get the correct selector
          const iframeObserveOptions = executionModel
            ? { instruction: action, modelName: executionModel, iframes: true }
            : { instruction: action, iframes: true };

          const iframeObserveResults =
            await stagehandPage.page.observe(iframeObserveOptions);

          if (!iframeObserveResults || iframeObserveResults.length === 0) {
            // If we can't observe anything in the iframe context, fail gracefully
            return {
              success: false,
              error: "No observable actions found within iframe context",
              isIframe: true,
              playwrightArguments: null as null,
            };
          }

          const iframeObserveResult = iframeObserveResults[0];
          const fallback = await stagehandPage.page.act(iframeObserveResult);

          return {
            success: fallback.success,
            action: fallback.action,
            isIframe: true,
            playwrightArguments: {
              description: iframeObserveResult.description,
              method: iframeObserveResult.method || "click",
              arguments: iframeObserveResult.arguments || [],
              selector: iframeObserveResult.selector,
            },
          };
        }

        // For regular (non-iframe) actions, use the original observe result
        const playwrightArguments = {
          description: observeResult.description,
          method: observeResult.method || "click",
          arguments: observeResult.arguments || [],
          selector: observeResult.selector,
        };

        return {
          success: result.success,
          action: result.action,
          isIframe: false,
          playwrightArguments,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          playwrightArguments: null as null,
        };
      }
    },
  });
