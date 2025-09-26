import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createScrollTool = (stagehand: Stagehand) =>
  tool({
    description:
      "Scroll the page by a percentage of the current viewport height. More dynamic and robust than fixed pixel amounts.",
    parameters: z.object({
      percentage: z
        .number()
        .min(1)
        .max(200)
        .default(80)
        .optional()
        .describe(
          "Percentage of viewport height to scroll (1-200%, default: 80%)",
        ),
      direction: z.enum(["up", "down"]).describe("Direction to scroll"),
      coordinates: z
        .array(z.number())
        .describe(
          "the (x, y) coordinates to scroll inside of, if not provided, will scroll the page",
        )
        .optional(),
    }),
    execute: async ({ percentage = 80, direction, coordinates }) => {
      const viewportHeight = await stagehand.page.evaluate(
        () => window.innerHeight,
      );
      const scrollDistance = Math.round((viewportHeight * percentage) / 100);

      if (coordinates) {
        await stagehand.page.mouse.move(coordinates[0], coordinates[1]);
      }
      await stagehand.page.mouse.wheel(
        0,
        direction === "up" ? -scrollDistance : scrollDistance,
      );
      return {
        success: true,
        message: `scrolled ${percentage}% of viewport ${direction} (${scrollDistance}px of ${viewportHeight}px viewport height)`,
      };
    },
  });
