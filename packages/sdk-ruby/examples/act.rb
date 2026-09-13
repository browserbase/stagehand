# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/act.py.

require_relative "example_helpers"

ExampleHelpers.with_stagehand do |stagehand, page|
  page.goto("https://example.com")

  result = stagehand.act("Click the link that provides more information about Example Domain")

  puts JSON.pretty_generate(result.data.to_wire)

  raise "act() failed: #{result.data.message}" unless result.data.success
end
