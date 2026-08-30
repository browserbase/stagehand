# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_zillow.ts

Evals.define_task("extract_zillow") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/zillow/")

  result = t.stagehand.extract(
    "Extract EACH AND EVERY HOME PRICE AND ADDRESS ON THE PAGE. DO NOT MISS ANY OF THEM.",
    schema: {
      "type" => "object",
      "properties" => {
        "listings" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "price" => { "type" => "string", "description" => "The price of the home" },
              "trails" => { "type" => "string", "description" => "The address of the home" },
            },
            "required" => %w[price trails],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["listings"],
      "additionalProperties" => false,
    },
  )

  listings = result.data["listings"]
  expected_length = 38

  if listings.length < expected_length
    t.logger.error("Incorrect number of listings extracted",
                   { expected: expected_length, actual: listings.length })
    next { _success: false, error: "Incorrect number of listings extracted" }
  end

  { _success: true }
end
