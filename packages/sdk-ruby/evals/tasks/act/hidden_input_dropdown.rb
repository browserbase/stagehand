# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/hidden_input_dropdown.ts

Evals.define_task("hidden_input_dropdown") do |t|
  # This eval is meant to test whether we do not incorrectly attempt
  # the selectOptionFromDropdown method (defined in actHandlerUtils.ts) on a
  # hidden input 'dropdown'.
  #
  # This kind of dropdown must be clicked to be expanded before being interacted
  # with.

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/hidden-input-dropdown/")

  t.stagehand.act("click to expand the 'Favourite Colour' dropdown")

  # we are expecting stagehand to click the dropdown to expand it,
  # and therefore the available options should now be contained in the full
  # a11y tree.

  # to test, we'll grab the full a11y tree, and make sure it contains 'Green'
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
  full_tree = extraction["extraction"]

  if full_tree.include?("Green")
    next { _success: true }
  end

  { _success: false, message: "unable to expand the dropdown" }
end
