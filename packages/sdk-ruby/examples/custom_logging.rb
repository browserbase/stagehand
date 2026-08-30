# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/custom_logging.py: every
# stagehand.log notification is appended to stagehand.jsonl via on_log
# (in addition to the client's default stderr echo).
#
#   ruby examples/custom_logging.rb                # local Chrome (needs OPENAI_API_KEY)
#   ruby examples/custom_logging.rb --browserbase  # Browserbase (Model Gateway)

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

File.open("stagehand.jsonl", "a", encoding: "utf-8") do |log_file|
  on_log = ->(log) { log_file.puts(JSON.generate(log.to_wire)) }

  begin
    create_options = { browser: browser, log_level: "info", on_log: on_log }
    unless openai_api_key.empty?
      create_options[:model] = "openai/gpt-5.4-mini"
      create_options[:model_api_key] = openai_api_key
    end
    stagehand = Stagehand.create(**create_options)
    begin
      page = browser.context.pages.first
      raise "Stagehand initialized without an active page" if page.nil?
      page.goto("https://example.com")
      puts JSON.pretty_generate(stagehand.observe("Find the Learn more link").data.map(&:to_wire))
    ensure
      stagehand.close
    end
  ensure
    browser.close
  end
end

puts "Structured logs appended to stagehand.jsonl"
