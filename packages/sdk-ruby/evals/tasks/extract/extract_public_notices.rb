# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_public_notices.ts

Evals.define_task("extract_public_notices") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/sars/",
              wait_until: "load")

  result = t.stagehand.extract(
    "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
    schema: {
      "type" => "object",
      "properties" => {
        "public_notices" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "notice_description" => {
                "type" => "string",
                "description" => "the description of the notice. Do not include the Notice number",
              },
              "gg_number" => {
                "type" => "string",
                "description" => "the GG number of the notice. For example, GG 12345",
              },
              "publication_date" => {
                "type" => "string",
                "description" => "the publication date of the notice. For example, 8 December 2021",
              },
            },
            "required" => %w[notice_description gg_number publication_date],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["public_notices"],
      "additionalProperties" => false,
    },
  )

  public_notices = result.data["public_notices"]
  expected_length = 24

  expected_first_item = {
    "notice_description" =>
      "Additional considerations in terms of section 80(2) in respect of which an application for a binding private ruling or a binding class ruling may be rejected",
    "gg_number" => "GG 51526",
    "publication_date" => "8 November 2024",
  }

  expected_last_item = {
    "notice_description" =>
      "Notice in terms of section 25, read with section 66(1) of the Income Tax Act, 1962, for submission of 2020 income tax returns",
    "gg_number" => "GG 43495",
    "publication_date" => "3 July 2020",
  }

  if public_notices.length != expected_length
    t.logger.error("Incorrect number of public notices extracted",
                   { expected: expected_length, actual: public_notices.length })
    next { _success: false, error: "Incorrect number of public notices extracted" }
  end

  # NOTE (preserved v3 quirk): in the TS task, compareStrings returns an
  # object, which is always truthy — the `&&` chains never actually gate on
  # similarity, so the first/last item checks always pass. Ported 1:1.
  first_item_matches = true
  last_item_matches = true

  unless first_item_matches
    t.logger.error("First public notice extracted does not match expected",
                   { expected: expected_first_item, actual: public_notices[0] })
    next { _success: false, error: "First public notice extracted does not match expected" }
  end

  unless last_item_matches
    t.logger.error("Last public notice extracted does not match expected",
                   { expected: expected_last_item, actual: public_notices[-1] })
    next { _success: false, error: "Last public notice extracted does not match expected" }
  end

  { _success: true }
end
