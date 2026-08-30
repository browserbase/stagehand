# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/ionwave_observe.ts

Evals.define_task("ionwave_observe") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/")

  observations = t.stagehand.observe.data

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  expected_result = t.page.locator("#Form1 > div:nth-child(5) > div:nth-child(1) > a").first.inner_text

  found_match = observations.any? do |observation|
    t.page.locator(observation.selector).first.inner_text == expected_result
  rescue StandardError
    false
  end

  { _success: found_match, expected: expected_result, observations: observations.map(&:to_wire) }
end
