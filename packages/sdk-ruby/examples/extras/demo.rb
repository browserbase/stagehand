# frozen_string_literal: true

# Walking-skeleton demo: goto -> observe -> act -> extract.
#
#   ruby examples/demo.rb                # local Chrome
#   ruby examples/demo.rb --browserbase  # Browserbase session (BROWSERBASE_API_KEY)
#   HEADED=1 ruby examples/demo.rb       # watch the local browser
#
# Model resolution: MODEL_NAME + MODEL_API_KEY, or OPENAI_API_KEY /
# ANTHROPIC_API_KEY / GOOGLE_API_KEY. On Browserbase the model may be omitted
# entirely (Model Gateway picks one).

require_relative "../../lib/stagehand"

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

use_browserbase = ARGV.include?("--browserbase")
model, model_api_key = resolve_model
browserbase_api_key = env("BROWSERBASE_API_KEY")
if model.nil? && browserbase_api_key.nil?
  abort "Set OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY (or MODEL_NAME + MODEL_API_KEY), " \
        "or BROWSERBASE_API_KEY to use the Model Gateway."
end

browser =
  if use_browserbase
    api_key = browserbase_api_key or abort "Set BROWSERBASE_API_KEY to run the Browserbase demo."
    puts "Creating a Browserbase session (uploading the Stagehand extension)..."
    Stagehand::Browserbase.launch(api_key: api_key)
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

stagehand = nil
begin
  create_options = { browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "info") }
  if model && model_api_key
    create_options[:model] = model
    create_options[:model_api_key] = model_api_key
  else
    # No provider key: let the Browserbase Model Gateway pick a model.
    create_options[:api_key] = browserbase_api_key
  end
  stagehand = Stagehand.create(**create_options)
  puts "Session: #{browser.session_id}" if browser.session_id

  page = browser.context.active_page || browser.context.pages.first
  navigation = page.goto("https://docs.stagehand.dev/")
  puts "Navigated to #{navigation.page.url.inspect} (title: #{page.title.inspect})"

  observations = stagehand.observe("find the main navigation links")
  puts "observe -> #{observations.data.length} candidate actions"
  observations.data.first(3).each { |action| puts "  - #{action.description} (#{action.selector})" }

  act_result = stagehand.act("click the link to the quickstart guide")
  puts "act -> success=#{act_result.data.success}: #{act_result.data.message}"

  extraction = stagehand.extract(
    "extract the page title and the first paragraph of the page",
    schema: {
      "type" => "object",
      "properties" => {
        "title" => { "type" => "string" },
        "first_paragraph" => { "type" => "string" },
      },
      "required" => %w[title first_paragraph],
      "additionalProperties" => false,
    },
  )
  puts "extract -> #{JSON.pretty_generate(extraction.data)}"
  usage = extraction.metadata.usage
  puts "usage -> input=#{usage["input_tokens"]} output=#{usage["output_tokens"]} inference_ms=#{usage["inference_time_ms"]}"
ensure
  stagehand&.close
  browser.close
  puts "Closed."
end
