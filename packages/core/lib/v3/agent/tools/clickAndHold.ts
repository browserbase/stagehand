import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3.js";
import type { Action } from "../../types/public/methods.js";
import { processCoordinates } from "../utils/coordinateNormalization.js";
import { ensureXPath } from "../utils/xpath.js";
import { withTimeout } from "../../timeoutConfig.js";
import { TimeoutError } from "../../types/public/sdkErrors.js";

export const clickAndHoldTool = (
  v3: V3,
  provider?: string,
  toolTimeout?: number,
) =>
  tool({
    description: "Click and hold on an element using its coordinates",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to click on in a short, specific phrase that mentions the element type and a good visual description",
        ),
      duration: z
        .number()
        .describe("The duration to hold the element in milliseconds"),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to click on"),
    }),
    execute: async ({ describe, coordinates, duration }) => {
      try {
        return await withTimeout(
          (async () => {
            const page = await v3.context.awaitActivePage();
            const processed = processCoordinates(
              coordinates[0],
              coordinates[1],
              provider,
              v3,
            );

            v3.logger({
              category: "agent",
              message: `Agent calling tool: clickAndHold`,
              level: 1,
              auxiliary: {
                arguments: {
                  value: JSON.stringify({
                    describe,
                    duration,
                  }),
                  type: "object",
                },
              },
            });

            // Only request XPath when caching is enabled to avoid unnecessary computation
            const shouldCollectXpath = v3.isAgentReplayActive();

            // Use dragAndDrop from same point to same point with delay to simulate click and hold
            const [xpath] = await page.dragAndDrop(
              processed.x,
              processed.y,
              processed.x,
              processed.y,
              { delay: duration, returnXpath: shouldCollectXpath },
            );

            // Record as "act" step with proper Action for deterministic replay (only when caching)
            if (shouldCollectXpath) {
              const normalizedXpath = ensureXPath(xpath);
              if (normalizedXpath) {
                const action: Action = {
                  selector: normalizedXpath,
                  description: describe,
                  method: "clickAndHold",
                  arguments: [String(duration)],
                };
                v3.recordAgentReplayStep({
                  type: "act",
                  instruction: describe,
                  actions: [action],
                  actionDescription: describe,
                });
              }
            }

            return { success: true, describe };
          })(),
          toolTimeout,
          "clickAndHold()",
        );
      } catch (error) {
        if (error instanceof TimeoutError) {
          const timeoutMessage = `TimeoutError: ${error.message}`;
          v3.logger({
            category: "agent",
            message: timeoutMessage,
            level: 0,
          });
          return {
            success: false,
            error: timeoutMessage,
          };
        }
        return {
          success: false,
          error: `Error clicking and holding: ${(error as Error).message}`,
        };
      }
    },
  });
