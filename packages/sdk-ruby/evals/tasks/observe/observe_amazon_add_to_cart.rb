# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_amazon_add_to_cart.ts

Evals.define_task("observe_amazon_add_to_cart") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/amazon/")

  observations1 = t.stagehand.observe("Find and click the 'Add to Cart' button").data

  # Example of using performPlaywrightMethod if you have the xpath
  t.stagehand.act(observations1[0]) unless observations1.empty?

  observations2 = t.stagehand.observe("Find and click the 'Proceed to checkout' button").data

  # Example of using performPlaywrightMethod if you have the xpath
  t.stagehand.act(observations2[0]) unless observations2.empty?

  current_url = t.page.url
  expected_url_prefix = "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html"

  { _success: current_url.start_with?(expected_url_prefix), currentUrl: current_url }
end
