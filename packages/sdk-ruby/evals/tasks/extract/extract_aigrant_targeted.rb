# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_aigrant_targeted.ts

Evals.define_task("extract_aigrant_targeted") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")
  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator("xpath=/html/body/div/ul[5]/li[28]")
  result = t.stagehand.extract(
    "Extract the company name.",
    schema: {
      "type" => "object",
      "properties" => { "company_name" => { "type" => "string" } },
      "required" => ["company_name"],
      "additionalProperties" => false,
    },
    locator: locator,
  )

  company_name = result.data["company_name"]
  expected_name = "Coframe"

  if company_name != expected_name
    t.logger.error("extracted company name does not match expected",
                   { expected: expected_name, actual: company_name })
    next { _success: false, error: "Company name does not match expected" }
  end

  { _success: true, companyName: company_name }
end
