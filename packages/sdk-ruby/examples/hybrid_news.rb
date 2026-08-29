# frozen_string_literal: true

# Hybrid AI + deterministic workflow on Hacker News:
#   1. goto + wait_for_selector
#   2. deterministic: count story rows with a locator
#   3. AI: extract the top stories (title/points) with a schema
#   4. deterministic: click the "More" link via locator, verify page 2
#   5. screenshot the result
#
#   ruby examples/hybrid_news.rb --browserbase   # (AI needs a model; Gateway on Browserbase)
#   ruby examples/hybrid_news.rb                 # local Chrome + provider key

require_relative "example_helpers"

TOP_STORIES = {
  "type" => "object",
  "properties" => {
    "stories" => {
      "type" => "array",
      "items" => {
        "type" => "object",
        "properties" => {
          "title" => { "type" => "string" },
          "points" => { "type" => "integer" },
        },
        "required" => %w[title points],
        "additionalProperties" => false,
      },
    },
  },
  "required" => ["stories"],
  "additionalProperties" => false,
}.freeze

ExampleHelpers.with_stagehand do |stagehand, page|
  page.goto("https://news.ycombinator.com")
  page.wait_for_selector(".athing", state: "visible")

  rows = page.locator(".athing")
  puts "deterministic -> #{rows.count} story rows on page 1"
  puts "deterministic -> first row: #{rows.first.text_content.strip[0, 80].inspect}"

  result = stagehand.extract(
    "Extract the titles and point counts of the top 3 stories",
    schema: TOP_STORIES,
  )
  result.data["stories"].each_with_index do |story, index|
    puts "AI extract    -> #{index + 1}. #{story["title"]} (#{story["points"]} points)"
  end

  page.locator("a.morelink").click
  page.wait_for_load_state("load")
  puts "deterministic -> clicked More, now on #{page.url.inspect}"
  puts "deterministic -> #{page.locator(".athing").count} story rows on page 2"

  shot_path = File.join(Dir.tmpdir, "stagehand-ruby-hn.png")
  page.screenshot(path: shot_path)
  puts "screenshot    -> #{shot_path}"
end
