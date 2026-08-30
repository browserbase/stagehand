# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/panamcs.ts

Evals.define_task("panamcs") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/panamcs/")

  observations = t.stagehand.observe("click the 'about us' link").data

  if observations.empty?
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  expected_locator = "#menu > li:nth-child(1) > a"

  expected_result = t.page.locator(expected_locator).first.inner_text

  found_match = observations.any? do |observation|
    t.page.locator(observation.selector).first.inner_text == expected_result
  rescue StandardError => e
    t.logger.log("Failed to check observation with selector #{observation.selector}: #{e.message}")
    false
  end

  { _success: found_match, expected: expected_result, observations: observations.map(&:to_wire) }
end
