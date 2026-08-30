# frozen_string_literal: true

# Basic observe test against Everything Arctic Cat Off-Road (the WebTailBench
# "everythingarcticcatoffroad" target site) using the Ruby client.
#
#   ruby examples/arctic_observe.rb                # local Chrome (needs a provider key)
#   ruby examples/arctic_observe.rb --browserbase  # Browserbase (Model Gateway, needs BROWSERBASE_API_KEY)
#   HEADED=1 ruby examples/arctic_observe.rb       # watch the local browser
#
# Flow: goto -> observe (nav) -> observe (search box) -> observe (product links).

require_relative "../../lib/stagehand"

SITE = ENV.fetch("ARCTIC_URL", "https://www.everythingarcticcatoffroad.com/")

def env(name)
  value = ENV.fetch(name, nil)
  value unless value.nil? || value.empty?
end

def resolve_model
  return [env("MODEL_NAME"), env("MODEL_API_KEY")] if env("MODEL_NAME")
  return ["openai/gpt-5-mini", env("OPENAI_API_KEY")] if env("OPENAI_API_KEY")
  return ["anthropic/claude-haiku-4-5", env("ANTHROPIC_API_KEY")] if env("ANTHROPIC_API_KEY")
  return ["google/gemini-2.5-flash", env("GOOGLE_API_KEY")] if env("GOOGLE_API_KEY")
  [nil, nil]
end

def show(label, observations, limit: 5)
  puts "#{label}: #{observations.data.length} candidate action(s)"
  observations.data.first(limit).each do |action|
    puts "  - #{action.description}"
    puts "    selector=#{action.selector} method=#{action.method}"
  end
end

use_browserbase = ARGV.include?("--browserbase")
model, model_api_key = resolve_model
browserbase_api_key = env("BROWSERBASE_API_KEY")
if model.nil? && browserbase_api_key.nil?
  abort "Set a provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY or " \
        "MODEL_NAME + MODEL_API_KEY), or BROWSERBASE_API_KEY for the Model Gateway."
end

browser =
  if use_browserbase
    api_key = browserbase_api_key or abort "Set BROWSERBASE_API_KEY to run the Browserbase mode."
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: api_key)
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

stagehand = nil
begin
  create_options = { browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn") }
  if model && model_api_key
    create_options[:model] = model
    create_options[:model_api_key] = model_api_key
  else
    create_options[:api_key] = browserbase_api_key
  end
  stagehand = Stagehand.create(**create_options)
  puts "Session: #{browser.session_id}" if browser.session_id

  page = browser.context.active_page || browser.context.pages.first
  page.goto(SITE)
  puts "Navigated to #{page.url.inspect} (title: #{page.title.inspect})"

  show("observe(main navigation)",
       stagehand.observe("find the main site navigation links"))
  show("observe(search)",
       stagehand.observe("find the product search input"), limit: 3)
  show("observe(products)",
       stagehand.observe("find links or tiles for Arctic Cat Prowler parts or featured products"))
ensure
  stagehand&.close
  browser.close
  puts "Closed."
end
