import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

// Schema for Claude CUA models - includes coordinates parameter for precise scrolling
const claudeParametersSchema = z.object({
  percentage: z
    .number()
    .min(1)
    .max(200)
    .default(80)
    .optional()
    .describe("Percentage of viewport height to scroll (1-200%, default: 80%)"),
  direction: z.enum(["up", "down"]).describe("Direction to scroll"),
  coordinates: z
    .array(z.number())
    .describe(
      "the (x, y) coordinates to scroll inside of, if not provided, will scroll the page",
    )
    .optional(),
});

// Schema for non-Claude models - no coordinates parameter
const defaultParametersSchema = z.object({
  percentage: z
    .number()
    .min(1)
    .max(200)
    .describe("Percentage of viewport height to scroll (1-200%, default: 80%)"),
  direction: z.enum(["up", "down"]).describe("Direction to scroll"),
});

export const createScrollTool = (stagehand: Stagehand, isClaude = false) => {
  const parametersSchema = isClaude
    ? claudeParametersSchema
    : defaultParametersSchema;

  return tool({
    description:
      "Scroll the page by a percentage of the current viewport height. More dynamic and robust than fixed pixel amounts.",
    parameters: parametersSchema as z.ZodType<{
      percentage?: number;
      direction: "up" | "down";
      coordinates?: number[];
    }>,
    execute: async (params) => {
      const percentage = params.percentage ?? 80;
      const direction = params.direction;
      const coordinates =
        "coordinates" in params ? params.coordinates : undefined;
      const viewportHeight = await stagehand.page.evaluate(
        () => window.innerHeight,
      );
      const scrollDistance = Math.round((viewportHeight * percentage) / 100);

      if (coordinates && coordinates.length > 0) {
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
};
