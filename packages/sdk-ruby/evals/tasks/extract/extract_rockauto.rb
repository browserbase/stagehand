# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_rockauto.ts

Evals.define_task("extract_rockauto") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/rockauto/")
  t.page.wait_for_timeout(5000)

  result = t.stagehand.extract(
    "Extract the part number of all the coolant and antifreeze products in the 'economy' category. " \
    "Do not include the manufacturer name. Do not include products from the premium category.",
    schema: {
      "type" => "object",
      "properties" => {
        "coolant_products" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "part_number" => { "type" => "string" },
            },
            "required" => ["part_number"],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["coolant_products"],
      "additionalProperties" => false,
    },
  )

  coolant_products = result.data["coolant_products"]
  expected_part_numbers = %w[GREEN5050GAL 719009 AF3300 AF3100 MV5050GAL]
  expected_length = expected_part_numbers.length

  if coolant_products.length != expected_length
    t.logger.error("Incorrect number of coolant products extracted",
                   { expected: expected_length, actual: coolant_products.length })
    next { _success: false, error: "Incorrect number of coolant products extracted" }
  end

  missing_parts = expected_part_numbers.reject do |expected_part|
    coolant_products.any? { |p| p["part_number"] == expected_part }
  end

  unless missing_parts.empty?
    t.logger.error("Missing expected part number(s)",
                   { missingParts: missing_parts, actualExtracted: coolant_products })
    next {
      _success: false,
      error: "One or more expected part numbers were not found: #{missing_parts.join(', ')}",
    }
  end

  { _success: true }
end
