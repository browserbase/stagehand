import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";
import { buildActObservePrompt } from "../../prompt";
import { SupportedPlaywrightAction } from "@/types/act";
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
        const builtPrompt = buildActObservePrompt(
          action,
          Object.values(SupportedPlaywrightAction),
        );

        const observeOptions = executionModel
          ? {
              instruction: builtPrompt,
              modelName: executionModel,
            }
          : {
              instruction: builtPrompt,
            };

        const observeResults = await stagehandPage.page.observe(observeOptions);

        if (!observeResults || observeResults.length === 0) {
          return {
            success: false,
            error: "No observable actions found for the given instruction",
          };
        }

        const observeResult = observeResults[0];

        const isIframeAction = observeResult.description === "an iframe";

        if (isIframeAction) {
          const iframeObserveOptions = executionModel
            ? {
                instruction: builtPrompt,
                modelName: executionModel,
                iframes: true,
              }
            : {
                instruction: builtPrompt,
                iframes: true,
              };

          const iframeObserveResults =
            await stagehandPage.page.observe(iframeObserveOptions);

          if (!iframeObserveResults || iframeObserveResults.length === 0) {
            return {
              success: false,
              error: "No observable actions found within iframe context",
              isIframe: true,
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
              method: iframeObserveResult.method,
              arguments: iframeObserveResult.arguments,
              selector: iframeObserveResult.selector,
            },
          };
        }

        const result = await stagehandPage.page.act(observeResult);
        const playwrightArguments = {
          description: observeResult.description,
          method: observeResult.method,
          arguments: observeResult.arguments,
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
        };
      }
    },
  });
