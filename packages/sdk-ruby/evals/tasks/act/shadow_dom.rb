# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/shadow_dom.ts

Evals.define_task("shadow_dom") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/")
  t.stagehand.act("click the button")
  # v3 used schemaless extract; v4 requires a schema.
  # Single-word key to stay clear of the snake_case wire-casing bug (#14).
  extraction = t.stagehand.extract(
    "extract the page text",
    schema: {
      "type" => "object",
      "properties" => { "extraction" => { "type" => "string" } },
      "required" => ["extraction"],
      "additionalProperties" => false,
    },
  ).data

  page_text = extraction["extraction"]

  { _success: page_text.include?("button successfully clicked") }
end
