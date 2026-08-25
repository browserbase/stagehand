# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/observe.py.

require_relative "example_helpers"

ExampleHelpers.with_stagehand do |stagehand, page|
  page.goto("https://example.com")

  result = stagehand.observe("Find the link that provides more information about Example Domain")

  puts JSON.pretty_generate(result.data.map(&:to_wire))

  raise "observe() returned no matching actions" if result.data.empty?
end
