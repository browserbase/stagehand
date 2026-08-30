# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/act.py.
#
#   ruby examples/act.rb                # local Chrome (needs OPENAI_API_KEY)
#   ruby examples/act.rb --browserbase  # Browserbase (Model Gateway, no provider key)

require "json"

require_relative "../lib/stagehand"

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

    result = stagehand.act("Click the link that provides more information about Example Domain")

    puts JSON.pretty_generate(result.data.to_wire)

    raise "act() failed: #{result.data.message}" unless result.data.success
  ensure
    stagehand.close
  end
ensure
  browser.close
end
