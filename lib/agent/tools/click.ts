import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createClickTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Click on an element using its coordinates ( this is the most reliable way to click on an element, always use this over act, unless the element is not visible in the screenshot, but shown in ariaTree)",
    parameters: z.object({
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
        await stagehand.page.mouse.move(coordinates[0], coordinates[1]);
        await stagehand.page.mouse.click(coordinates[0], coordinates[1]);
        return { success: true, describe, coordinates };
      } catch {
        return { success: false, error: `Error clicking, try again` };
      }
    },
  });
