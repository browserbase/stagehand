# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_geniusee_2.ts

Evals.define_task("extract_geniusee_2") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/")
  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator("xpath=/html/body/main/div[2]/div[2]/div[2]/table/tbody/tr[9]")
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

  # scalability_comment_we_should_not_get matches a scalability comment in the table,
  # but since we are using targeted_extract here,
  # and passing in a selector that does NOT contain the scalability_comment_we_should_not_get,
  # the LLM should have no visibility into scalability_comment_we_should_not_get if
  # targeted_extract is performing correctly
  scalability_comment_we_should_not_get = "Scalable architecture with API access"

  if scalability_comment == scalability_comment_we_should_not_get
    t.logger.error("extracted scalability comment matches the scalability comment that we SHOULD NOT get",
                   { expected: scalability_comment_we_should_not_get, actual: scalability_comment })
    next {
      _success: false,
      error: "scalability comment matches the scalability comment that we SHOULD NOT get",
    }
  end

  { _success: true, scalabilityComment: scalability_comment }
end
