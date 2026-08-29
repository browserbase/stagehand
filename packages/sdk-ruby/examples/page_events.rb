# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/page_events.py: subscribe to page
# console events via page.on, trigger one with evaluate, then AI-extract the
# page content.
#
#   ruby examples/page_events.rb --browserbase   # (AI needs a model; Gateway on Browserbase)
#   ruby examples/page_events.rb                 # local Chrome + provider key

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
  console_events = Thread::Queue.new
  subscription = page.on("console") do |event|
    # Runs on the RPC reader thread: only hand the event over, no RPC calls.
    console_events << event if event.params.is_a?(Hash) && event.params["type"] == "log"
  end

  begin
    page.goto("https://example.com")
    page.evaluate('console.log("stagehand-page-on-example"); "emitted"')
    event = console_events.pop(timeout: 10)
    raise "console event did not arrive within 10s" if event.nil?

    result = stagehand.extract("Extract the page heading and description", schema: PAGE_INFO)
    puts JSON.pretty_generate({ "event_method" => event.method, "extracted" => result.data })
  ensure
    subscription.unsubscribe
  end
end
