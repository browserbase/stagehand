# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/extract.py. The schema is a plain
# JSON Schema Hash (the spike has no Pydantic/zod equivalent).

require_relative "example_helpers"

PAGE_INFO = {
  "type" => "object",
  "properties" => {
    "heading" => { "type" => "string" },
    "description" => { "type" => "string" },
  },
  "required" => %w[heading description],
  "additionalProperties" => false,
}.freeze

ExampleHelpers.with_stagehand do |stagehand, page|
  page.goto("https://example.com")

  result = stagehand.extract("Extract the page heading and description", schema: PAGE_INFO)

  puts JSON.pretty_generate(result.data)
end
