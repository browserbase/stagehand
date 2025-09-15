import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";

export const createScrollTool = (stagehandPage: StagehandPage) =>
  tool({
    description: "Scroll the page",
    parameters: z.object({
      pixels: z.number().describe("Number of pixels to scroll up or down"),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
      coordinates: z
        .array(z.number())
        .describe(
          "the (x, y) coordinates to scroll inside of, if not provided, will scroll the page",
        )
        .optional(),
    }),
    execute: async ({ pixels, direction, coordinates }) => {
      if (coordinates) {
        await stagehandPage.page.mouse.move(coordinates[0], coordinates[1]);
      }
      await stagehandPage.page.mouse.wheel(
        0,
        direction === "up" ? -pixels : pixels,
      );
      return { success: true, pixels };
    },
  });
