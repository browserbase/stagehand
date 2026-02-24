import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import type {
  FillFormVisionToolResult,
  ModelOutputContentItem,
  Variables,
} from "../../types/public/agent.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { waitAndCaptureScreenshot } from "../utils/screenshotHandler.js";
import { substituteVariables } from "../utils/variables.js";

export const fillFormVisionTool = (
  v3: V3,
  provider?: string,
  variables?: Variables,
) => {
  const hasVariables = variables && Object.keys(variables).length > 0;
  const valueDescription = hasVariables
    ? `Text to type into the target field. Use %variableName% to substitute a variable value. Available: ${Object.keys(variables).join(", ")}`
    : "Text to type into the target field";

  return tool({
    description: `FORM FILL - SPECIALIZED MULTI-FIELD INPUT TOOL

CRITICAL: Use this for ANY form with 2+ input fields (text inputs, textareas, etc.)
IMPORTANT: Ensure the fields are visible within the current viewport

WHY THIS TOOL EXISTS:
- Forms are the #1 use case for multi-field input
- Optimized specifically for input/textarea elements
- 4-6x faster than individual typing actions

Use fillFormVision: Pure form filling (inputs, textareas only)
MANDATORY USE CASES (always use fillFormVision for these):
- Registration forms: name, email, password fields
- Contact forms: name, email, message fields
- Checkout forms: address, payment info fields
- Profile updates: multiple user data fields
- Search filters: multiple criteria inputs`,
    inputSchema: z.object({
      fields: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                "Description of the typing action, e.g. 'type foo into the bar field'",
              ),
            value: z.string().describe(valueDescription),
            coordinates: z
              .object({
                x: z.number(),
                y: z.number(),
              })
              .describe("Coordinates of the target field"),
          }),
        )
        .min(2, "Provide at least two fields to fill"),
    }),
    execute: async ({ fields }): Promise<FillFormVisionToolResult> => {
      try {
        const page = await v3.context.awaitActivePage();

        // Process coordinates and substitute variables for each field
        // Keep original values (with %tokens%) for logging/caching, substituted values for typing
        const processedFields = fields.map((field) => {
          const processed = processCoordinates(
            field.coordinates.x,
            field.coordinates.y,
            provider,
            v3,
          );
          return {
            ...field,
            originalValue: field.value, // Keep original with %tokens% for cache
            value: substituteVariables(field.value, variables),
            coordinates: { x: processed.x, y: processed.y },
          };
        });

        v3.logger({
          category: "agent",
          message: `Agent calling tool: fillFormVision`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ fields }), // Don't log substituted values
              type: "object",
            },
          },
        });

        // Only request XPath when caching is enabled to avoid unnecessary computation
        const shouldCollectXpath = v3.isAgentReplayActive();
        const actions: Action[] = [];

        for (const field of processedFields) {
          // Click the field, only requesting XPath when caching is enabled
          const xpath = await page.click(
            field.coordinates.x,
            field.coordinates.y,
            {
              returnXpath: shouldCollectXpath,
            },
          );
          await page.type(field.value);

          // Build Action with XPath for deterministic replay (only when caching)
          // Use originalValue (with %tokens%) so cache stores references, not sensitive values
          if (shouldCollectXpath) {
            const normalizedXpath = ensureXPath(xpath);
            if (normalizedXpath) {
              actions.push({
                selector: normalizedXpath,
                description: field.action,
                method: "type",
                arguments: [field.originalValue],
              });
            }
          }

          // Small delay between fields
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const screenshotBase64 = await waitAndCaptureScreenshot(page, 100);

        // Record as "act" step with proper Actions for deterministic replay (only when caching)
        if (shouldCollectXpath && actions.length > 0) {
          v3.recordAgentReplayStep({
            type: "act",
            instruction: `Fill ${fields.length} form fields`,
            actions,
            actionDescription: `Fill ${fields.length} form fields`,
          });
        }

        return {
          success: true,
          playwrightArguments: processedFields,
          screenshotBase64,
        };
      } catch (error) {
        return {
          success: false,
          error: `Error filling form: ${(error as Error).message}`,
        };
      }
    },
    toModelOutput: (result) => {
      if (result.success) {
        const content: ModelOutputContentItem[] = [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              fieldsCount: result.playwrightArguments?.length ?? 0,
            }),
          },
        ];
        if (result.screenshotBase64) {
          content.push({
            type: "media",
            mediaType: "image/png",
            data: result.screenshotBase64,
          });
        }
        return { type: "content", value: content };
      }
      return {
        type: "content",
        value: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              error: result.error,
            }),
          },
        ],
      };
    },
  });
};
