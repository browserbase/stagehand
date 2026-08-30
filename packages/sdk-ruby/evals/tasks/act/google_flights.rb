# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/google_flights.ts

# This eval attempts to click on an element that should not pass the playwright actionability check
# which happens by default if you call locator.click (more information here:
# https://playwright.dev/docs/actionability)
#
# If this eval passes, it means that we have correctly set {force: true} in performPlaywrightMethod,
# and the click was successful even though the target element (found by the xpath) did not
# pass the actionability check.

Evals.define_task("google_flights") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/")

  observe_result = Stagehand::Models::Action.new(
    selector:
      "xpath=/html/body/c-wiz[2]/div/div[2]/c-wiz/div[1]/c-wiz/div[2]/div[2]/div[2]/div/div[2]/div[1]/ul/li[1]/div/div[1]",
    description: "the first departing flight",
    method: "click",
    arguments: [],
  )
  t.stagehand.act(observe_result)

  expected_url =
    "https://browserbase.github.io/stagehand-eval-sites/sites/google-flights/return-flight.html"
  current_url = t.page.url

  if current_url == expected_url
    next { _success: true, currentUrl: current_url }
  end

  { _success: false, error: "The current URL does not match expected." }
end
