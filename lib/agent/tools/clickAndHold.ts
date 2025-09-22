import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createClickAndHoldTool = (stagehand: Stagehand) =>
  tool({
    description: "Click and hold on an element using its coordinates",
    parameters: z.object({
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
      await stagehand.page.mouse.move(coordinates[0], coordinates[1]);
      await stagehand.page.mouse.down();
      await stagehand.page.waitForTimeout(duration);
      await stagehand.page.mouse.up();
      return { success: true, describe, coordinates, duration };
    },
  });
