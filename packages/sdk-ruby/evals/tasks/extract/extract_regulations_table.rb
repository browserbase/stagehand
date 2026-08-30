# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_regulations_table.ts

Evals.define_task("extract_regulations_table") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ncc-numbering-plan/")

  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator(
    "xpath=/html/body/div[3]/main/div[2]/div[2]/div/div/div[2]/article/div[2]/div[1]/div/table",
  )

  result = t.stagehand.extract(
    "Extract ALL of the Allottees and their corresponding name, area, and area code.",
    schema: {
      "type" => "object",
      "properties" => {
        "allottee_list" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "allottee_name" => { "type" => "string" },
              "area" => { "type" => "string" },
              "area_code" => { "type" => "string" },
              "access_code" => { "type" => "string" },
            },
            "required" => %w[allottee_name area area_code access_code],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["allottee_list"],
      "additionalProperties" => false,
    },
    locator: locator,
  )

  allottees = result.data

  allottees_expected_first = {
    "allottee_name" => "101 Communications Limited",
    "area" => "Lagos",
    "area_code" => "0201",
    "access_code" => "249",
  }

  allottees_expected_last = {
    "allottee_name" => "Airtel Networks Limited",
    "area" => "National",
    "area_code" => "0708",
    "access_code" => "708",
  }

  expected_length = 25

  allottee_list = allottees["allottee_list"]

  # Check that the first entry, last entry, and total number match expectations
  is_first_correct = allottee_list[0] == allottees_expected_first
  is_last_correct = allottee_list[-1] == allottees_expected_last
  is_length_correct = allottee_list.length == expected_length

  is_regulations_correct = is_first_correct && is_last_correct && is_length_correct

  { _success: is_regulations_correct, regulationsData: allottees }
end
