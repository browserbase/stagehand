import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createTypeTool = (stagehandPage: StagehandPage) =>
  tool({
    description:
      "Type text into an element using its coordinates. this will click the element and then type the text into it ( this is the most reliable way to type into an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    parameters: z.object({
      describe: z.string().describe("Describe the element to click on"),
      text: z.string().describe("The text to type into the element"),
      coordinates: z
        .array(z.number())
        .describe("The (x, y) coordinates to type into the element"),
    }),
    execute: async ({ describe, coordinates, text }) => {
      await stagehandPage.page.mouse.click(coordinates[0], coordinates[1]);
      await stagehandPage.page.keyboard.type(text);
      return { success: true, describe, coordinates, text };
    },
  });
