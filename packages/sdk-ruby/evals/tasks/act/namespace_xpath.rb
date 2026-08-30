# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/namespace_xpath.ts

Evals.define_task("namespace_xpath") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/namespaced-xpath/")

  t.stagehand.act("fill 'nunya' into the 'type here' form")

  input_value = t.page.locator("#ns-text").input_value
  # confirm that the form was filled
  form_has_been_filled = input_value == "nunya"

  { _success: form_has_been_filled }
end
