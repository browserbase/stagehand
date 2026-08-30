# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/checkboxes.ts

Evals.define_task("checkboxes") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/checkboxes/")

  t.stagehand.act("click the 'baseball' option")

  t.stagehand.act("click the 'netball' option")

  baseball_checked = t.page.locator('input[type="checkbox"][name="sports"][value="baseball"]').checked?

  netball_checked = t.page.locator('input[type="checkbox"][name="sports"][value="netball"]').checked?

  { _success: baseball_checked && netball_checked }
end
