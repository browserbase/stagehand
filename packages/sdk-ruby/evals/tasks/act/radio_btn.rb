# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/radio_btn.ts

Evals.define_task("radio_btn") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/paneer-pizza/")

  t.stagehand.act("click the 'medium' option")

  # confirm that the Medium radio is now checked
  radio_btn_clicked = t.page.locator('input[type="radio"][name="Pizza"][value="Medium"]').checked?

  { _success: radio_btn_clicked }
end
