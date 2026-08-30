# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_csa.ts

Evals.define_task("extract_csa") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/csa/")

  result = t.stagehand.extract(
    "Extract all the publications on the page including the publication date, " \
    "session type, publication type, and annotation",
    schema: {
      "type" => "object",
      "properties" => {
        "publications" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "publication_date" => { "type" => "string" },
              "session_type" => { "type" => "string" },
              "publication_type" => { "type" => "string" },
              "annotation" => { "type" => "string" },
            },
            "required" => %w[publication_date session_type publication_type annotation],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["publications"],
      "additionalProperties" => false,
    },
    page: t.page,
  )

  publications = result.data["publications"]
  expected_length = 14

  expected_first_item = {
    "publication_date" => "11-30-2024",
    "session_type" => "Regular Session",
    "publication_type" => "Assembly Weekly History",
    "annotation" =>
      "2024 -- This publication includes the complete histories of second-year bills. " \
      "The complete electronic history of all bills is always available at leginfo.legislature.ca.gov",
  }

  expected_last_item = {
    "publication_date" => "11-30-2016",
    "session_type" => "1st Extraordinary Session",
    "publication_type" => "Assembly Weekly History",
    "annotation" => "",
  }

  if publications.length < expected_length
    t.logger.error("Incorrect number of publications extracted",
                   { expected: ">= #{expected_length}", actual: publications.length })
    next { _success: false, error: "Incorrect number of publications extracted" }
  end

  has_expected_first_item = publications.any? do |publication|
    publication["publication_date"] == expected_first_item["publication_date"] &&
      publication["session_type"] == expected_first_item["session_type"] &&
      publication["publication_type"] == expected_first_item["publication_type"] &&
      publication["annotation"] == expected_first_item["annotation"]
  end

  unless has_expected_first_item
    t.logger.error("Expected 'first' item not found in publications",
                   { expected: expected_first_item, actual: publications })
    next { _success: false, error: "Expected 'first' item not found in publications" }
  end

  has_expected_last_item = publications.any? do |publication|
    publication["publication_date"] == expected_last_item["publication_date"] &&
      publication["session_type"] == expected_last_item["session_type"] &&
      publication["publication_type"] == expected_last_item["publication_type"] &&
      publication["annotation"] == expected_last_item["annotation"]
  end

  unless has_expected_last_item
    t.logger.error("Expected 'last' item not found in publications",
                   { expected: expected_last_item, actual: publications })
    next { _success: false, error: "Expected 'last' item not found in publications" }
  end

  { _success: true }
end
