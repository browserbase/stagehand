# frozen_string_literal: true

# A complete search journey mixing deterministic input with AI extraction:
#   1. goto DuckDuckGo (static HTML version — stable selectors)
#   2. fill the query with a locator, submit with Enter
#   3. wait for results
#   4. AI: extract the top results (title + snippet) with a schema
#
#   ruby examples/search_flow.rb --browserbase   # (AI needs a model; Gateway on Browserbase)
#   ruby examples/search_flow.rb                 # local Chrome + provider key

require_relative "example_helpers"

QUERY = ENV.fetch("QUERY", "Stagehand browser automation")

SEARCH_RESULTS = {
  "type" => "object",
  "properties" => {
    "results" => {
      "type" => "array",
      "items" => {
        "type" => "object",
        "properties" => {
          "title" => { "type" => "string" },
          "snippet" => { "type" => "string" },
        },
        "required" => %w[title snippet],
        "additionalProperties" => false,
      },
    },
  },
  "required" => ["results"],
  "additionalProperties" => false,
}.freeze

ExampleHelpers.with_stagehand do |stagehand, page|
  page.goto("https://html.duckduckgo.com/html/")
  page.wait_for_selector('input[name="q"]', state: "visible")

  search_box = page.locator('input[name="q"]')
  search_box.fill(QUERY)
  puts "typed        -> #{search_box.input_value.inspect}"
  page.key_press("Enter")

  page.wait_for_selector(".result__title", state: "visible", timeout: 15_000)
  puts "results page -> #{page.title.inspect}"
  puts "deterministic-> #{page.locator(".result").count} results visible"

  extraction = stagehand.extract(
    "Extract the top 3 search results with their titles and snippets",
    schema: SEARCH_RESULTS,
  )
  extraction.data["results"].each_with_index do |result, index|
    puts "AI extract   -> #{index + 1}. #{result["title"]}"
    puts "                #{result["snippet"][0, 100]}"
  end
end
