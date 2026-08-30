# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/ionwave.ts

Evals.define_task("ionwave") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/")

  t.stagehand.act('Click on "Closed Bids"')

  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/closed-bids.html"
  current_url = t.page.url

  { _success: current_url.start_with?(expected_url), currentUrl: current_url }
end
