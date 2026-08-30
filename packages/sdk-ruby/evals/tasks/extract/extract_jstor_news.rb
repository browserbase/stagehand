# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_jstor_news.ts

Evals.define_task("extract_jstor_news") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/jstor/", wait_until: "load")
  t.stagehand.act("close the cookie")

  result = t.stagehand.extract(
    "Extract ALL the news report titles and their dates.",
    schema: {
      "type" => "object",
      "properties" => {
        "reports" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "report_name" => {
                "type" => "string",
                "description" => "The name or title of the news report.",
              },
              "publish_date" => {
                "type" => "string",
                "description" => "The date the news report was published.",
              },
            },
            "required" => %w[report_name publish_date],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["reports"],
      "additionalProperties" => false,
    },
  )

  reports = result.data["reports"]
  expected_length = 10

  expected_first_item = {
    "report_name" => "JSTOR retires Publisher Sales Service",
    "publish_date" => "December 9, 2024",
  }

  expected_last_item = {
    "report_name" => "Path to Open announces 2024 titles",
    "publish_date" => "May 10, 2024",
  }

  if reports.length != expected_length
    t.logger.error("Incorrect number of reports extracted",
                   { expected: expected_length, actual: reports.length })
    next { _success: false, error: "Incorrect number of reports extracted" }
  end

  first_item_matches =
    reports.first["report_name"] == expected_first_item["report_name"] &&
    reports.first["publish_date"] == expected_first_item["publish_date"]

  unless first_item_matches
    t.logger.error("First report extracted does not match expected",
                   { expected: expected_first_item, actual: reports.first })
    next { _success: false, error: "First report extracted does not match expected" }
  end

  last_item_matches =
    reports.last["report_name"] == expected_last_item["report_name"] &&
    reports.last["publish_date"] == expected_last_item["publish_date"]

  unless last_item_matches
    t.logger.error("Last report extracted does not match expected",
                   { expected: expected_last_item, actual: reports.last })
    next { _success: false, error: "Last report extracted does not match expected" }
  end

  { _success: true }
end
