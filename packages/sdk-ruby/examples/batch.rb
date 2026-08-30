# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/batch.py: run trusted JavaScript
# against the worker-local Stagehand object model in one round trip. No LLM
# calls are made, so this runs with zero provider keys locally.
#
#   ruby examples/batch.rb                # local Chrome
#   ruby examples/batch.rb --browserbase  # Browserbase session

require "json"

require_relative "../lib/stagehand"

browser =
  if ARGV.include?("--browserbase")
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: ENV.fetch("BROWSERBASE_API_KEY"))
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

begin
  stagehand = Stagehand.create(browser: browser, log_level: "warn")
  begin
    result = stagehand.experimental_batch(
      <<~JS,
        async (batch, input) => {
          await batch.page.goto(input.url);
          return {
            title: await batch.page.title(),
            heading: await batch.page.locator("h1").innerText(),
          };
        }
      JS
      { "url" => "https://example.com" },
      timeout: 30_000,
    )

    puts JSON.pretty_generate(result)
  ensure
    stagehand.close
  end
ensure
  browser.close
end
