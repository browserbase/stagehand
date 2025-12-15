import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import { processCoordinates } from "../utils/coordinateNormalization";

export const createClickAndHoldTool = (v3: V3, provider?: string) =>
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
        const processed = processCoordinates(coordinates[0], coordinates[1], provider);

        v3.logger({
          category: "agent",
          message: `Agent calling tool: clickAndHold`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, coordinates, processed, duration }),
              type: "string",
            },
          },
        });
        // Use dragAndDrop from same point to same point with delay to simulate click and hold
        await page.dragAndDrop(
          processed.x,
          processed.y,
          processed.x,
          processed.y,
          { delay: duration },
        );
        v3.recordAgentReplayStep({
          type: "clickAndHold",
          instruction: describe,
          playwrightArguments: { coordinates: [processed.x, processed.y], duration },
        });
        return { success: true, describe };
      } catch (error) {
        return {
          success: false,
          error: `Error clicking and holding: ${(error as Error).message}`,
        };
      }
    },
  });
