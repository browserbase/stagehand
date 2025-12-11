import { tool } from "ai";
import { z } from "zod";
import type { V3 } from "../../v3";

export const createDragAndDropTool = (v3: V3) =>
  tool({
    description:
      "Drag and drop an element using its coordinates (this is the most reliable way to drag and drop an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    inputSchema: z.object({
      describe: z.string().describe("Describe the element to drag and drop"),
      startCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to start the drag and drop from"),
      endCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to end the drag and drop at"),
    }),
    execute: async ({ describe, startCoordinates, endCoordinates }) => {
      try {
        const page = await v3.context.awaitActivePage();
        v3.logger({
          category: "agent",
          message: `Agent calling tool: dragAndDrop`,
          level: 1,
          auxiliary: {
            arguments: {
              value: JSON.stringify({ describe, startCoordinates, endCoordinates }),
              type: "string",
            },
          },
        });
        await page.dragAndDrop(
          startCoordinates[0],
          startCoordinates[1],
          endCoordinates[0],
          endCoordinates[1],
        );
        v3.recordAgentReplayStep({
          type: "dragAndDrop",
          instruction: describe,
          playwrightArguments: { startCoordinates, endCoordinates },
        });
        return { success: true, describe };
      } catch (error) {
        return {
          success: false,
          error: `Error dragging: ${(error as Error).message}`,
        };
      }
    },
  });
