import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_recipe: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/allrecipes-extract/",
      {
        waitUntil: "domcontentloaded",
      },
    );

    const selector = "/html/body/main/article/div[3]/div[3]/div[4]";
    const recipeDetails = await stagehand.page.extract({
      instruction:
        "Extract the title of the number of tablespoons of olive oil needed for the steak, and the number of teaspoons of lemon juice needed for the mushroom pan sauce.",
      schema: z.object({
        tablespoons_olive_oil: z
          .number()
          .describe(
            "the number of tablespoons of olive oil needed for the steak",
          ),
        teaspoons_lemon_juice: z
          .number()
          .describe(
            "the number of teaspoons of lemon juice needed for the mushroom pan sauce",
          ),
      }),

      selector: selector,
    });

    const { tablespoons_olive_oil, teaspoons_lemon_juice } = recipeDetails;
    const expectedTablespoons = 2;
    const expectedTeaspoons = 2;

    if (
      tablespoons_olive_oil !== expectedTablespoons ||
      teaspoons_lemon_juice !== expectedTeaspoons
    ) {
      const errors = [];
      if (tablespoons_olive_oil !== expectedTablespoons) {
        errors.push({
          message:
            "Extracted tablespoons of olive oil do not match the extracted tablespoons of olive oil",
          expected: expectedTablespoons.toString(),
          actual: tablespoons_olive_oil.toString(),
        });
      }
      if (teaspoons_lemon_juice !== expectedTeaspoons) {
        errors.push({
          message:
            "Extracted teaspoons of lemon juice do not match the extracted teaspoons of lemon juice",
          expected: expectedTeaspoons.toString(),
          actual: teaspoons_lemon_juice.toString(),
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
        tablespoons_olive_oil: expectedTablespoons,
        teaspoons_lemon_juice: expectedTeaspoons,
      },
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
