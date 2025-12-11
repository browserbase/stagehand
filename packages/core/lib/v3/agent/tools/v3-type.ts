import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createTypeTool = (v3: V3) =>
  tool({
    description:
      "Type text into an element using its coordinates. This will click the element and then type the text into it (this is the most reliable way to type into an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z
        .string()
        .describe(
          "Describe the element to type into in a short, specific phrase that mentions the element type and a good visual description",
        ),
      text: z.string().describe("The text to type into the element"),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to type into the element"),
    }),
    execute: async ({ describe, coordinates, text }) => {
      try {
        const page = await v3.context.awaitActivePage();
        v3.logger({
          category: "agent",
          message: `Agent calling tool: type`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, coordinates, text }),
              type: "string",
            },
          },
        });
        // Click the element first, then type
        await page.click(coordinates[0], coordinates[1]);
        await page.type(text);
        v3.recordAgentReplayStep({
          type: "type",
          instruction: describe,
          playwrightArguments: { coordinates, text },
        });
        return { success: true, describe, text };
      } catch (error) {
        return {
          success: false,
          error: `Error typing: ${(error as Error).message}`,
        };
      }
    },
  });
