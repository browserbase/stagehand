# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/wikipedia.ts

Evals.define_task("wikipedia") do |t|
  t.page.goto("https://en.wikipedia.org/wiki/Baseball")
  t.stagehand.act('click the "hit and run" link in this article', timeout: 360_000)

  url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)"
  current_url = t.page.url

  { _success: current_url == url, expected: url, actual: current_url }
end
