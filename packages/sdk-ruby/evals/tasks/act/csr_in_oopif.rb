# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/csr_in_oopif.ts

Evals.define_task("csr_in_oopif") do |t|
  # this eval is designed to test whether stagehand can successfully
  # click inside an CSR (closed mode shadow) root that is inside an
  # OOPIF (out of process iframe)

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-root-in-oopif/")
  t.stagehand.act("click the button")

  t.page.wait_for_timeout(1000)

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
    next { _success: true, message: "successfully clicked the button" }
  end

  { _success: false, message: "unable to click on the button" }
end
