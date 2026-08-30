# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/os_dropdown.ts

Evals.define_task("os_dropdown") do |t|
  # This eval is meant to test whether we can correctly select an element
  # from an OS level dropdown

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/")

  t.stagehand.act("choose 'Smog Check Technician' from the 'License Type' dropdown")
  # v3 used page.locator("#licenseType >> option:checked"); v4 locator has
  # no ">>" chaining, so the same check is re-expressed in-page.
  selected_option = t.page.evaluate(<<~JS)
    (() => {
      const option = document.querySelector("#licenseType option:checked");
      return option?.textContent ?? null;
    })()
  JS

  if selected_option == "Smog Check Technician"
    next { _success: true }
  end

  { _success: false, message: "incorrect option selected from the dropdown" }
end
