# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/custom_logging.py: every
# stagehand.log notification is appended to stagehand.jsonl via on_log
# (in addition to the client's default stderr echo).

require_relative "example_helpers"

File.open("stagehand.jsonl", "a", encoding: "utf-8") do |log_file|
  on_log = ->(log) { log_file.puts(JSON.generate(log.to_wire)) }

  ExampleHelpers.with_stagehand(log_level: "info", on_log: on_log) do |stagehand, page|
    page.goto("https://example.com")
    puts JSON.pretty_generate(stagehand.observe("Find the Learn more link").data.map(&:to_wire))
  end
end

puts "Structured logs appended to stagehand.jsonl"
