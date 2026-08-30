# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_taxes.ts

Evals.define_task("observe_taxes") do |t|
  t.page.goto("https://file.1040.com/estimate/")

  observations = t.stagehand.observe("Find all the form input elements under the 'Income' section").data

  if observations.empty? || observations.length < 13
    next { _success: false, observations: observations.map(&:to_wire) }
  end

  expected_locator = "#tpWages"

  expected_result = t.page.locator(expected_locator).first.inner_text

  found_match = observations.any? do |observation|
    t.page.locator(observation.selector).first.inner_text == expected_result
  rescue StandardError => e
    t.logger.log("Failed to check observation with selector #{observation.selector}: #{e.message}")
    false
  end

  { _success: found_match, expected: expected_result, observations: observations.map(&:to_wire) }
end
