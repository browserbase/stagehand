# frozen_string_literal: true

# WebMCP: pages can register tools (navigator.modelContext); Stagehand lists
# them via page.tools and invokes them. Ruby port of
# packages/sdk-python/examples/webmcp.py — no LLM needed.
#
#   ruby examples/webmcp.rb                # local Chrome (headed, like the sibling SDKs)
#   ruby examples/webmcp.rb --browserbase  # Browserbase session

require "json"

require_relative "../lib/stagehand"
require_relative "example_helpers"

WEBMCP_TEST_SITE = "https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/"

browser =
  if ARGV.include?("--browserbase")
    api_key = ExampleHelpers.env("BROWSERBASE_API_KEY") or abort "Set BROWSERBASE_API_KEY."
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: api_key)
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: false)
  end

begin
  stagehand = Stagehand.create(browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn"))
  begin
    page = browser.context.pages.first
    raise "Stagehand initialized without an active page" if page.nil?
    page.goto(WEBMCP_TEST_SITE)

    tools = page.tools(timeout: 5_000)
    puts "tools -> #{tools.map(&:name).join(", ")}"
    calculate_sum = tools.find { |tool| tool.name == "calculateSum" }
    raise "calculateSum was not registered by the page" if calculate_sum.nil?

    invocation = calculate_sum.invoke(input: { a: 19, b: 23 })
    result = invocation.result

    puts JSON.pretty_generate(result.to_wire)
  ensure
    stagehand.close
  end
ensure
  browser.close
end
puts "Closed."
