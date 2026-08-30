# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/amazon_add_to_cart.ts

Evals.define_task("amazon_add_to_cart") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/amazon/")

  t.stagehand.act("click the 'Add to Cart' button")

  t.stagehand.act("click the 'Proceed to checkout' button")

  current_url = t.page.url
  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html"

  t.logger.log("currentUrl #{current_url}")
  t.logger.log("expectedUrl #{expected_url}")

  { _success: current_url == expected_url, currentUrl: current_url }
end
