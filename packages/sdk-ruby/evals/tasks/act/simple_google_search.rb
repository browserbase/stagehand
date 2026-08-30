# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/simple_google_search.ts

Evals.define_task("simple_google_search") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/")

  t.stagehand.act('type "OpenAI" into the search bar')

  t.stagehand.act("press enter")
  t.page.wait_for_timeout(3000)

  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html"
  current_url = t.page.url

  { _success: current_url.start_with?(expected_url), currentUrl: current_url }
end
