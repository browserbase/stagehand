# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_repo_name.ts

Evals.define_task("extract_repo_name") do |t|
  t.page.goto("https://github.com/facebook/react")

  # v3 used schemaless extract; v4 requires a schema.
  # Single-word key to stay clear of the snake_case wire-casing bug (#14).
  result = t.stagehand.extract(
    "extract the title of the Github repository. Do not include the owner of the repository.",
    schema: {
      "type" => "object",
      "properties" => { "extraction" => { "type" => "string" } },
      "required" => ["extraction"],
      "additionalProperties" => false,
    },
  )

  extraction = result.data["extraction"]

  t.logger.log("Extracted repo title", { repo_name: extraction })

  { _success: extraction == "react", extraction: extraction }
end
