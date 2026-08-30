# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/caching.py. Server-side caching
# requires a Browserbase browser session, so this always runs there.
#
#   ruby examples/caching.rb   # needs BROWSERBASE_API_KEY

require "json"

require_relative "../lib/stagehand"

COMPANIES = {
  "type" => "object",
  "properties" => {
    "companies" => {
      "type" => "array",
      "items" => {
        "type" => "object",
        "properties" => {
          "name" => { "type" => "string" },
          "description" => { "type" => "string" },
        },
        "required" => %w[name description],
        "additionalProperties" => false,
      },
    },
  },
  "required" => ["companies"],
  "additionalProperties" => false,
}.freeze

puts "Creating a Browserbase session..."
browser = Stagehand::Browserbase.launch(api_key: ENV.fetch("BROWSERBASE_API_KEY"))

begin
  stagehand = Stagehand.create(browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn"))
  begin
    page = browser.context.pages.first
    raise "Stagehand initialized without an active page" if page.nil?
    page.goto("https://aigrant.com")

    extract_companies = lambda do
      start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      result = stagehand.extract(
        "Extract the names and descriptions of the first five companies listed on the page",
        schema: COMPANIES,
        cache: true,
      )
      [result, ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000).round]
    end

    describe_cache = ->(result) { result.metadata.cache ? JSON.generate(result.metadata.cache.to_wire) : "disabled" }

    first, first_duration_ms = extract_companies.call
    puts "First extraction (#{first_duration_ms}ms):"
    puts JSON.pretty_generate(first.data)
    puts "Cache: #{describe_cache.call(first)}"

    second, second_duration_ms = extract_companies.call
    puts "Second extraction (#{second_duration_ms}ms):"
    puts JSON.pretty_generate(second.data)
    puts "Cache: #{describe_cache.call(second)}"
  ensure
    stagehand.close
  end
ensure
  browser.close
end
