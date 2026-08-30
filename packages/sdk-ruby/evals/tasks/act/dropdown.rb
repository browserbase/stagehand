# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/dropdown.ts

Evals.define_task("dropdown") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/")

  # click the dropdown element to expand it
  t.page.locator("xpath=/html/body/div/div/button").click

  # type into the input box (which should be hidden behind the expanded dropdown)
  t.stagehand.act("type 'test fill' into the input field")

  expected_value = "test fill"
  actual_value = t.page.locator("xpath=/html/body/div/input").input_value

  { _success: actual_value == expected_value, expectedValue: expected_value, actualValue: actual_value }
end
