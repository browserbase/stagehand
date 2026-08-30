# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_nhl_stats.ts

Evals.define_task("extract_nhl_stats") do |t|
  # Port of the evals framework's normalizeString helper.
  normalize = lambda do |str|
    str.downcase
       .gsub(/\s+/, " ")
       .gsub(/[;\/#!$%^&*:{}=\-_`~()]/, "")
       .gsub(/\s*,\s*/, ", ")
       .strip
  end

  t.page.goto("https://www.hockeydb.com/ihdb/stats/top_league.php?lid=nhl1927&sid=1990",
              wait_until: "domcontentloaded")

  result = t.stagehand.extract(
    "Extract the name of the goal scoring leader, their number of goals they scored, and the team they played for.",
    schema: {
      "type" => "object",
      "properties" => {
        "name" => { "type" => "string" },
        "num_goals" => { "type" => "string" },
        "team" => { "type" => "string" },
      },
      "required" => %w[name num_goals team],
      "additionalProperties" => false,
    },
  )

  name = result.data["name"]
  num_goals = result.data["num_goals"]
  team = result.data["team"]

  expected = {
    "name" => "Brett Hull",
    "num_goals" => "72",
    "team" => "St. Louis",
  }

  if normalize.call(name) != normalize.call(expected["name"])
    t.logger.error("Player name extracted does not match expected",
                   { expected: normalize.call(expected["name"]), actual: normalize.call(name) })
    next { _success: false, error: "Player name extracted does not match expected" }
  end

  if normalize.call(num_goals) != normalize.call(expected["num_goals"])
    t.logger.error("Number of goals extracted does not match expected",
                   { expected: normalize.call(expected["num_goals"]), actual: normalize.call(num_goals) })
    next { _success: false, error: "Number of goals extracted does not match expected" }
  end

  if normalize.call(team) != normalize.call(expected["team"])
    t.logger.error("Player team extracted does not match expected",
                   { expected: normalize.call(expected["team"]), actual: normalize.call(team) })
    next { _success: false, error: "Player team extracted does not match expected" }
  end

  { _success: true }
end
