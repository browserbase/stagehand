# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/vantechjournal.ts

Evals.define_task("vantechjournal") do |t|
  t.page.goto("https://vantechjournal.com")

  t.stagehand.act("click on page 'recommendations'")

  expected_url = "https://vantechjournal.com/recommendations"
  current_url = t.page.url

  { _success: current_url == expected_url, currentUrl: current_url, expectedUrl: expected_url }
end
