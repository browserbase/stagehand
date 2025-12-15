import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";
import { processCoordinates } from "../utils/coordinateNormalization";

function waitForTimeout(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const createClickTool = (v3: V3, provider?: string) =>
  tool({
    description:
      "Click on an element using its coordinates (this is the most reliable way to click on an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to click on in a short, specific phrase that mentions the element type and a good visual description",
        ),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to click on"),
    }),
    execute: async ({ describe, coordinates }) => {
      try {
        const page = await v3.context.awaitActivePage();
        const processed = processCoordinates(coordinates[0], coordinates[1], provider);

        v3.logger({
          category: "agent",
          message: `Agent calling tool: click`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, coordinates, processed }),
              type: "string",
            },
          },
        });
        await page.click(processed.x, processed.y);
        await waitForTimeout(1000);
        v3.recordAgentReplayStep({
          type: "click",
          instruction: describe,
          playwrightArguments: { coordinates: [processed.x, processed.y] },
        });
        return { success: true, describe, coordinates: [processed.x, processed.y] };
      } catch (error) {
        return {
          success: false,
          error: `Error clicking: ${(error as Error).message}`,
        };
      }
    },
  });
