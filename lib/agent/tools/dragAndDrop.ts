import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createDragAndDropTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Drag and drop an element using its coordinates ( this is the most reliable way to drag and drop an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    parameters: z.object({
      describe: z.string().describe("Describe the element to drag and drop"),
      startCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to drag and drop"),
      endCoordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to start the drag and drop"),
    }),
    execute: async ({ describe, startCoordinates, endCoordinates }) => {
      await stagehand.page.mouse.move(startCoordinates[0], startCoordinates[1]);
      await stagehand.page.mouse.down();
      await stagehand.page.mouse.move(endCoordinates[0], endCoordinates[1]);
      await stagehand.page.mouse.up();
      return { success: true, describe };
    },
  });
