# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/page_events.py: subscribe to page
# console events via page.on, trigger one with evaluate, then AI-extract the
# page content.
#
#   ruby examples/page_events.rb                # local Chrome (needs OPENAI_API_KEY)
#   ruby examples/page_events.rb --browserbase  # Browserbase (Model Gateway)

require "json"

require_relative "../lib/stagehand"

PAGE_INFO = {
  "type" => "object",
  "properties" => {
    "heading" => { "type" => "string" },
    "description" => { "type" => "string" },
  },
  "required" => %w[heading description],
  "additionalProperties" => false,
}.freeze

openai_api_key = ENV.fetch("OPENAI_API_KEY", "")

browser =
  if ARGV.include?("--browserbase")
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: ENV.fetch("BROWSERBASE_API_KEY"))
  else
    abort "Local runs need OPENAI_API_KEY (the Browserbase Model Gateway is session-only)." if openai_api_key.empty?
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

begin
  create_options = { browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn") }
  unless openai_api_key.empty?
    create_options[:model] = "openai/gpt-5.4-mini"
    create_options[:model_api_key] = openai_api_key
  end
  stagehand = Stagehand.create(**create_options)
  begin
    page = stagehand.browser.context.active_page()
    raise "Stagehand initialized without an active page" if page.nil?

    console_events = Thread::Queue.new
    subscription = page.on("console") do |event|
      # Runs on an SDK inbound thread (deliveries may be concurrent): hand
      # the event over to the queue rather than doing work here.
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
  ensure
    stagehand.close
  end
ensure
  browser.close
end
