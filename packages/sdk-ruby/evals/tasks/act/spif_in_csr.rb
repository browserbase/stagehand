# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/spif_in_csr.ts

# this eval is designed to test whether stagehand can successfully
# click inside a SPIF (same process iframe) that is inside an
# CSR (closed mode shadow) root
Evals.define_task("spif_in_csr") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/spif-in-closed-shadow-dom/")
  t.stagehand.act("click the button")

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

  if page_text.include?("button successfully clicked")
    { _success: true, message: "successfully clicked the button" }
  else
    { _success: false, message: "unable to click on the button" }
  end
end
