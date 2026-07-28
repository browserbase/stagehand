import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "allrecipes" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://www.allrecipes.com/", {
        waitUntil: "domcontentloaded",
      });

      await stagehand.act('Type "chocolate chip cookies" in the search bar');
      await stagehand.act("press enter");

      const { data: recipeDetails } = await stagehand.extract(
        "Extract the title of the first recipe and the total number of ratings it has received.",
        z.object({
          title: z.string().describe("Title of the recipe"),
          total_ratings: z.string().describe("Total number of ratings for the recipe"),
        }),
      );

      const expectedTitle = "Best Chocolate Chip Cookies";
      const expectedRatings = 19164;
      const extractedRatings = Number.parseInt(
        recipeDetails.total_ratings.replace(/[^\d]/g, ""),
        10,
      );
      const isRatingsWithinRange =
        extractedRatings >= expectedRatings - 1000 && extractedRatings <= expectedRatings + 1000;

      return {
        _success: recipeDetails.title === expectedTitle && isRatingsWithinRange,
        recipeDetails: {
          title: recipeDetails.title,
          total_ratings: extractedRatings,
        },
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);
