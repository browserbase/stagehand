# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/custom_dropdown.ts

Evals.define_task("custom_dropdown") do |t|
  # This eval is meant to test whether we do not incorrectly attempt
  # the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
  # 'dropdown' that is not a <select> element.
  #
  # This kind of dropdown must be clicked to be expanded before being interacted
  # with.

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/expand-dropdown/")

  t.stagehand.act("choose Canada from the 'Select a Country' dropdown")

  # read the rendered page text directly — no second model call
  full_tree = t.page.locator("#chosenValue").inner_text

  if full_tree.include?("Canada")
    next { _success: true }
  end

  { _success: false, message: "unable to expand the dropdown" }
end
