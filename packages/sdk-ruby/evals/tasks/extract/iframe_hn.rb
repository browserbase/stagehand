# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/iframe_hn.ts

Evals.define_task("iframe_hn") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/")

  # NOTE: the target content lives inside an iframe, but the task relies
  # entirely on extract() to see into it (no frame API usage in v3 or
  # v4), so this ported 1:1 — iframe handling is the SDK's responsibility.
  result = t.stagehand.extract(
    "extract the title of the first hackernews story",
    schema: {
      "type" => "object",
      "properties" => { "story_title" => { "type" => "string" } },
      "required" => ["story_title"],
      "additionalProperties" => false,
    },
  )

  title = result.data["story_title"].downcase
  expected_title_substring = "overengineered anchor links"

  unless title.include?(expected_title_substring)
    t.logger.error("Extracted title: #{title} does not contain expected substring: #{expected_title_substring}")
    next {
      _success: false,
      error: "Extracted title: #{title} does not contain expected substring: #{expected_title_substring}",
    }
  end

  { _success: true }
end
