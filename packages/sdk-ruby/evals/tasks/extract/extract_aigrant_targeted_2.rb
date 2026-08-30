# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_aigrant_targeted_2.ts

Evals.define_task("extract_aigrant_targeted_2") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/")
  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator("xpath=/html/body/div/ul[5]/li[28]")
  result = t.stagehand.extract(
    "Extract the name of the company that comes after 'Coframe'.",
    schema: {
      "type" => "object",
      "properties" => { "company_name" => { "type" => "string" } },
      "required" => ["company_name"],
      "additionalProperties" => false,
    },
    locator: locator,
  )
  company_name = result.data["company_name"]

  # name_we_should_not_get matches the name of the company that comes after
  # CoFrame on the website. Since we are using targeted_extract here,
  # and passing in a selector that does NOT contain the name_we_should_not_get,
  # the LLM should have no visibility into what comes after 'CoFrame' if
  # targeted_extract is performing correctly
  name_we_should_not_get = "OpusClip"

  if company_name == name_we_should_not_get
    t.logger.error("extracted company name matches the company name that we SHOULD NOT get",
                   { expected: name_we_should_not_get, actual: company_name })
    next {
      _success: false,
      error: "extracted company name matches the company name that we SHOULD NOT get",
    }
  end

  { _success: true, companyName: company_name }
end
