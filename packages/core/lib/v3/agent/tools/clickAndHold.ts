import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import type { Action } from "../../types/public/methods";
import { processCoordinates } from "../utils/coordinateNormalization";
import { ensureXPath } from "../utils/xpath";

export const clickAndHoldTool = (v3: V3, provider?: string) =>
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
        const page = await v3.context.awaitActivePage();
        const processed = processCoordinates(
          coordinates[0],
          coordinates[1],
          provider,
        );

        v3.logger({
          category: "agent",
          message: `Agent calling tool: clickAndHold`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({
                describe,
                coordinates,
                processed,
                duration,
              }),
              type: "string",
            },
          },
        });

        // Use dragAndDrop from same point to same point with delay to simulate click and hold
        // returnXpath gives us the xpath of the element at that position
        const [xpath] = await page.dragAndDrop(
          processed.x,
          processed.y,
          processed.x,
          processed.y,
          { delay: duration, returnXpath: true },
        );

        // Record as "act" step with proper Action for deterministic replay
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

        return { success: true, describe };
      } catch (error) {
        return {
          success: false,
          error: `Error clicking and holding: ${(error as Error).message}`,
        };
      }
    },
  });
