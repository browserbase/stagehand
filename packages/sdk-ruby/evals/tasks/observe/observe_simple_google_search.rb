# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_simple_google_search.ts

Evals.define_task("observe_simple_google_search") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google/")

  observation1 = t.stagehand.observe("Find the search bar and type 'OpenAI'").data
  t.stagehand.act(observation1[0]) unless observation1.empty?

  observation2 = t.stagehand.observe("Press enter").data
  t.stagehand.act(observation2[0]) unless observation2.empty?

  t.page.wait_for_timeout(3000)

  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html"
  current_url = t.page.url

  { _success: current_url.start_with?(expected_url), currentUrl: current_url }
end
