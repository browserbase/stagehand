# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_single_link.ts

Evals.define_task("extract_single_link") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/")

  result = t.stagehand.extract(
    "extract the link to the 'contact us' page",
    schema: {
      "type" => "object",
      "properties" => { "link" => { "type" => "string", "format" => "uri" } },
      "required" => ["link"],
      "additionalProperties" => false,
    },
  )

  extracted_link = result.data["link"]
  expected_link = "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/#contact"

  if extracted_link == expected_link
    next { _success: true }
  end

  {
    _success: false,
    reason: "Extracted link: #{extracted_link} does not match expected link: #{expected_link}",
  }
end
