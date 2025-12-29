import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { Action } from "../../types/public/methods";
import type { FillFormVisionToolResult } from "../../types/public/agent";
import { processCoordinates } from "../utils/coordinateNormalization";
import { ensureXPath } from "../utils/xpath";

export const fillFormVisionTool = (v3: V3, provider?: string) =>
  tool({
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
            value: z.string().describe("Text to type into the target field"),
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

        // Process coordinates for each field
        const processedFields = fields.map((field) => {
          const processed = processCoordinates(
            field.coordinates.x,
            field.coordinates.y,
            provider,
          );
          return {
            ...field,
            coordinates: { x: processed.x, y: processed.y },
          };
        });

        v3.logger({
          category: "agent",
          message: `Agent calling tool: fillFormVision`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ fields, processedFields }),
              type: "string",
            },
          },
        });

        // Collect actions with XPaths for cache replay
        const actions: Action[] = [];

        for (const field of processedFields) {
          // Click the field with returnXpath to get the element's XPath
          const xpath = await page.click(
            field.coordinates.x,
            field.coordinates.y,
            {
              returnXpath: true,
            },
          );
          await page.type(field.value);

          // Build Action with XPath for deterministic replay
          const normalizedXpath = ensureXPath(xpath);
          if (normalizedXpath) {
            actions.push({
              selector: normalizedXpath,
              description: field.action,
              method: "type",
              arguments: [field.value],
            });
          }

          // Small delay between fields
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Wait for page to settle after filling all fields
        await page.waitForTimeout(500);

        // Take screenshot after action for visual feedback
        const screenshotBuffer = await page.screenshot({ fullPage: false });
        const screenshotBase64 = screenshotBuffer.toString("base64");

        // Record as "act" step with proper Actions for deterministic replay
        if (actions.length > 0) {
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
      if (result.screenshotBase64) {
        return {
          type: "content",
          value: [
            {
              type: "text",
              text: JSON.stringify({
                success: result.success,
                fieldsCount: result.playwrightArguments?.length ?? 0,
              }),
            },
            {
              type: "media",
              mediaType: "image/png",
              data: result.screenshotBase64,
            },
          ],
        };
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
