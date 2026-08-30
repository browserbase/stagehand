# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_geniusee.ts

Evals.define_task("extract_geniusee") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/")
  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator("xpath=/html/body/main/div[2]/div[2]/div[2]/table")
  result = t.stagehand.extract(
    "Extract the scalability comment in the table for Gemini (Google)",
    schema: {
      "type" => "object",
      "properties" => { "scalability" => { "type" => "string" } },
      "required" => ["scalability"],
      "additionalProperties" => false,
    },
    locator: locator,
  )

  scalability_comment = result.data["scalability"]
  expected_scalability_comment = "Scalable architecture with API access"

  if scalability_comment != expected_scalability_comment
    t.logger.error("extracted scalability comment does not match expected",
                   { expected: expected_scalability_comment, actual: scalability_comment })
    next { _success: false, error: "extracted scalability comment does not match expected" }
  end

  { _success: true, scalabilityComment: scalability_comment }
end
