import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createTypeTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Type text into an element using its coordinates. this will click the element and then type the text into it ( this is the most reliable way to type into an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    parameters: z.object({
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
        await stagehand.page.mouse.click(coordinates[0], coordinates[1]);
        await stagehand.page.keyboard.type(text);
      } catch {
        return { success: false, error: `Error typing, try again` };
      }
      return { success: true, describe, coordinates, text };
    },
  });
