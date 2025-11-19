import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const allrecipes: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.allrecipes.com/", {
      waitUntil: "domcontentloaded",
    });

    await v3.act('Type "chocolate chip cookies" in the search bar');
    await v3.act("press enter");

    const recipeDetails = await v3.extract(
      "Extract the title of the first recipe and the total number of ratings it has received.",
      z.object({
        title: z.string().describe("Title of the recipe"),
        total_ratings: z
          .string()
          .describe("Total number of ratings for the recipe"),
      }),
    );

    const { title, total_ratings } = recipeDetails;
    const expectedTitle = "Best Chocolate Chip Cookies";
    const expectedRatings = 19164;

    const extractedRatings = parseInt(total_ratings.replace(/[^\d]/g, ""), 10);
    const isRatingsWithinRange =
      extractedRatings >= expectedRatings - 1000 &&
      extractedRatings <= expectedRatings + 1000;

    if (title !== expectedTitle || !isRatingsWithinRange) {
      const errors = [];
      if (title !== expectedTitle) {
        errors.push({
          message: "Extracted title does not match the expected title",
          expected: expectedTitle,
          actual: title,
        });
      }
      if (!isRatingsWithinRange) {
        errors.push({
          message: "Extracted ratings are not within the expected range",
          expected: `${expectedRatings} ± 1000`,
          actual: extractedRatings.toString(),
        });
      }

      logger.error({
        message: "Failed to extract correct recipe details",
        level: 0,
        auxiliary: {
          errors: {
            value: JSON.stringify(errors),
            type: "object",
          },
        },
      });

      return {
        _success: false,
        error: "Recipe details extraction validation failed",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    return {
      _success: true,
      recipeDetails: {
        title,
        total_ratings: extractedRatings,
      },
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    return {
      _success: false,
      message: "Recipe details extraction validation failed",
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await v3.close();
  }
};
