# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/nonsense_action.ts

Evals.define_task("nonsense_action") do |t|
  t.page.goto("https://www.homedepot.com/")

  result = t.stagehand.act("what is the capital of the moon?").data

  # We expect this to fail
  { _success: !result.success }
end
