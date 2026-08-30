# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_apartments.ts

Evals.define_task("extract_apartments") do |t|
  t.page.goto("https://www.apartments.com/san-francisco-ca/2-bedrooms/", wait_until: "load")
  result = t.stagehand.extract(
    "Extract all the apartment listings with their prices and their addresses.",
    schema: {
      "type" => "object",
      "properties" => {
        "listings" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "price" => { "type" => "string", "description" => "The price of the listing" },
              "address" => { "type" => "string", "description" => "The address of the listing" },
            },
            "required" => %w[price address],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["listings"],
      "additionalProperties" => false,
    },
  )

  listings = result.data["listings"]
  expected_length = 40

  if listings.length < expected_length
    t.logger.error("Incorrect number of listings extracted",
                   { expected: expected_length, actual: listings.length })
    next { _success: false, error: "Incorrect number of listings extracted" }
  end

  { _success: true, listingCount: listings.length }
end
