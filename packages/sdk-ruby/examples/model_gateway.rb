# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/model_gateway.py. With no model
# configured, the Browserbase Model Gateway selects one automatically for each
# inference call; the Browserbase API key and session authenticate it.

require_relative "example_helpers"

PAGE_INFO = {
  "type" => "object",
  "properties" => {
    "heading" => { "type" => "string" },
    "domain" => { "type" => "string" },
  },
  "required" => %w[heading domain],
  "additionalProperties" => false,
}.freeze

api_key = ExampleHelpers.env("BROWSERBASE_API_KEY") or abort "Set BROWSERBASE_API_KEY."

puts "Creating a Browserbase session..."
browser = Stagehand::Browserbase.launch(api_key: api_key)
begin
  stagehand = Stagehand.create(browser: browser, api_key: api_key,
                               log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn"))
  begin
    puts "Session: #{browser.session_id}"
    page = browser.context.active_page || browser.context.pages.first
    page.goto("https://example.com")

    result = stagehand.extract(
      "Extract the page heading and the domain this page says it is for",
      schema: PAGE_INFO,
    )

    puts JSON.pretty_generate(result.data)
  ensure
    stagehand.close
  end
ensure
  browser.close
end
