# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_area_codes.ts

Evals.define_task("extract_area_codes") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ncc-area-codes/",
              wait_until: "domcontentloaded")

  result = t.stagehand.extract(
    "Extract ALL the Primary Center names and their corresponding Area Code, " \
    "and the name of their corresponding Zone.",
    schema: {
      "type" => "object",
      "properties" => {
        "primary_center_list" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "zone_name" => {
                "type" => "string",
                "description" =>
                  "The name of the Zone that the Primary Center is in. For example, 'North Central Zone'.",
              },
              "primary_center_name" => {
                "type" => "string",
                "description" =>
                  "The name of the Primary Center. I.e., this is the name of the city or town.",
              },
              "area_code" => {
                "type" => "string",
                "description" =>
                  "The area code for the Primary Center. This will either be 2 or 3 digits.",
              },
            },
            "required" => %w[zone_name primary_center_name area_code],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["primary_center_list"],
      "additionalProperties" => false,
    },
  )

  primary_center_list = result.data["primary_center_list"]
  expected_length = 56

  expected_first_item = {
    "zone_name" => "Lagos Zone",
    "primary_center_name" => "Lagos",
    "area_code" => "01",
  }

  expected_last_item = {
    "zone_name" => "South-East",
    "primary_center_name" => "Yenagoa",
    "area_code" => "089",
  }

  if primary_center_list.length != expected_length
    t.logger.error("Incorrect number of primary centers extracted",
                   { expected: expected_length, actual: primary_center_list.length })
    next { _success: false, error: "Incorrect number of primary centers extracted" }
  end

  first_item = primary_center_list.first
  first_item_matches =
    first_item["zone_name"] == expected_first_item["zone_name"] &&
    first_item["primary_center_name"] == expected_first_item["primary_center_name"] &&
    first_item["area_code"] == expected_first_item["area_code"]

  unless first_item_matches
    t.logger.error("First primary center extracted does not match expected",
                   { expected: expected_first_item, actual: first_item })
    next { _success: false, error: "First primary center extracted does not match expected" }
  end

  last_item = primary_center_list.last
  last_item_matches =
    last_item["zone_name"] == expected_last_item["zone_name"] &&
    last_item["primary_center_name"] == expected_last_item["primary_center_name"] &&
    last_item["area_code"] == expected_last_item["area_code"]

  unless last_item_matches
    t.logger.error("Last primary center extracted does not match expected",
                   { expected: expected_last_item, actual: last_item })
    next { _success: false, error: "Last primary center extracted does not match expected" }
  end

  { _success: true }
end
