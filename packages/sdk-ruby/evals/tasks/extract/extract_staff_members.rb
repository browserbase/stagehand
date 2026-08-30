# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_staff_members.ts

Evals.define_task("extract_staff_members") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/panamcs/")

  result = t.stagehand.extract(
    "extract a list of ALL the staff members on this page, with their name and their job title",
    schema: {
      "type" => "object",
      "properties" => {
        "staff_members" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "name" => { "type" => "string" },
              "job_title" => { "type" => "string" },
            },
            "required" => %w[name job_title],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["staff_members"],
      "additionalProperties" => false,
    },
  )

  staff_members = result.data["staff_members"]

  expected_length = 50

  expected_first_item = {
    "name" => "Louis Alvarez",
    "job_title" => "School Resource Officer",
  }

  expected_last_item = {
    "name" => "Jessica Zipin",
    "job_title" => "School Based Therapist",
  }

  if staff_members.length != expected_length
    t.logger.error("Incorrect number of items extracted",
                   { expected: expected_length, actual: staff_members.length })
    next { _success: false, error: "Incorrect number of staff members extracted" }
  end

  # Check for the presence of the expected items
  first_item_exists = staff_members.any? do |member|
    member["name"] == expected_first_item["name"] &&
      member["job_title"] == expected_first_item["job_title"]
  end

  unless first_item_exists
    t.logger.error("Expected first staff member not found in extracted data",
                   { expected: expected_first_item, actual: staff_members })
    next { _success: false, error: "Expected first staff member not found in extracted data" }
  end

  last_item_exists = staff_members.any? do |member|
    member["name"] == expected_last_item["name"] &&
      member["job_title"] == expected_last_item["job_title"]
  end

  unless last_item_exists
    t.logger.error("Expected last staff member not found in extracted data",
                   { expected: expected_last_item, actual: staff_members })
    next { _success: false, error: "Expected last staff member not found in extracted data" }
  end

  { _success: true }
end
