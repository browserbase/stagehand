# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/oopif_in_osr.ts

Evals.define_task("oopif_in_osr") do |t|
  # this eval is designed to test whether stagehand can successfully
  # fill a form inside a OOPIF (out of process iframe) that is inside an
  # OSR (open mode shadow) root

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-open-shadow-dom/")
  t.stagehand.act("fill 'nunya' into the first name field")

  # v3 used schemaless extract; v4 requires a schema.
  # Single-word key to stay clear of the snake_case wire-casing bug (#14).
  extraction = t.stagehand.extract(
    "extract the entire page text",
    schema: {
      "type" => "object",
      "properties" => { "extraction" => { "type" => "string" } },
      "required" => ["extraction"],
      "additionalProperties" => false,
    },
  ).data

  page_text = extraction["extraction"]

  if page_text.include?("nunya")
    next { _success: true, message: "successfully filled the form" }
  end

  { _success: false, message: "unable to fill the form" }
end
