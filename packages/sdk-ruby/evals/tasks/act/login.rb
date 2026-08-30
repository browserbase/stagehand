# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/login.ts

Evals.define_task("login") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/login/")

  t.stagehand.act("type %nunya% into the username field",
                  variables: { "nunya" => "business" })

  actual_value = t.page.locator("xpath=/html/body/main/form/div[1]/input").input_value

  expected_value = "business"

  { _success: actual_value == expected_value, expectedValue: expected_value, actualValue: actual_value }
end
