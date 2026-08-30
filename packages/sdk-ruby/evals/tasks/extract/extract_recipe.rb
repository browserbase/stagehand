# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_recipe.ts

Evals.define_task("extract_recipe") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/allrecipes-extract/",
              wait_until: "domcontentloaded")

  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator("xpath=/html/body/main/article/div[3]/div[3]/div[4]")
  result = t.stagehand.extract(
    "Extract the title of the number of tablespoons of olive oil needed for the steak, and the number of teaspoons of lemon juice needed for the mushroom pan sauce.",
    schema: {
      "type" => "object",
      "properties" => {
        "tablespoons_olive_oil" => {
          "type" => "number",
          "description" => "the number of tablespoons of olive oil needed for the steak",
        },
        "teaspoons_lemon_juice" => {
          "type" => "number",
          "description" => "the number of teaspoons of lemon juice needed for the mushroom pan sauce",
        },
      },
      "required" => %w[tablespoons_olive_oil teaspoons_lemon_juice],
      "additionalProperties" => false,
    },
    locator: locator,
  )

  tablespoons_olive_oil = result.data["tablespoons_olive_oil"]
  teaspoons_lemon_juice = result.data["teaspoons_lemon_juice"]
  expected_tablespoons = 2
  expected_teaspoons = 2

  if tablespoons_olive_oil != expected_tablespoons || teaspoons_lemon_juice != expected_teaspoons
    errors = []
    if tablespoons_olive_oil != expected_tablespoons
      errors << {
        message: "Extracted tablespoons of olive oil do not match the extracted tablespoons of olive oil",
        expected: expected_tablespoons.to_s,
        actual: tablespoons_olive_oil.to_s,
      }
    end
    if teaspoons_lemon_juice != expected_teaspoons
      errors << {
        message: "Extracted teaspoons of lemon juice do not match the extracted teaspoons of lemon juice",
        expected: expected_teaspoons.to_s,
        actual: teaspoons_lemon_juice.to_s,
      }
    end

    t.logger.error("Failed to extract correct recipe details", { errors: errors })

    next { _success: false, error: "Recipe details extraction validation failed" }
  end

  {
    _success: true,
    recipeDetails: {
      tablespoons_olive_oil: expected_tablespoons,
      teaspoons_lemon_juice: expected_teaspoons,
    },
  }
end
