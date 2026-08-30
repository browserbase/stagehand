# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/extract.py. The schema is a plain
# JSON Schema Hash (Ruby has no Pydantic/zod equivalent).
#
#   ruby examples/extract.rb                # local Chrome (needs OPENAI_API_KEY)
#   ruby examples/extract.rb --browserbase  # Browserbase (Model Gateway, no provider key)

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
    page = browser.context.pages.first
    raise "Stagehand initialized without an active page" if page.nil?
    page.goto("https://example.com")

    result = stagehand.extract("Extract the page heading and description", schema: PAGE_INFO)

    puts JSON.pretty_generate(result.data)
  ensure
    stagehand.close
  end
ensure
  browser.close
end
