# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/no_js_click.ts

Evals.define_task("no_js_click") do |t|
  # This eval is meant to test whether our `clickElement` function
  # (inside actHandlerUtils.ts) is able to click elements even if
  # the site blocks programmatic JS click events.

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/")

  observe_result = Stagehand::Models::Action.new(
    method: "click",
    selector: "xpath=/html/body/button",
    description: "the button to click",
    arguments: [],
  )
  t.stagehand.act(observe_result)

  text = t.page.locator("#success-msg").text_content
  if text&.strip == "click succeeded"
    next { _success: true }
  end

  { _success: false, message: "unable to click element on website that blocks JS click events" }
end
