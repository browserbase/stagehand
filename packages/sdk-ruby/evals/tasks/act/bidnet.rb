# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/bidnet.ts

Evals.define_task("bidnet") do |t|
  t.page.goto("https://www.bidnetdirect.com/")

  t.stagehand.act('Click on the "Construction" keyword')

  expected_url = "https://www.bidnetdirect.com/public/solicitations/open?keywords=Construction"
  current_url = t.page.url

  { _success: current_url.start_with?(expected_url), currentUrl: current_url }
end
