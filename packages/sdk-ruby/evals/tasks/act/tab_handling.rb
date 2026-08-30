# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/tab_handling.ts

Evals.define_task("tab_handling") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/")

  t.stagehand.act("click the button to open the other page")

  # active_page polls until the popup registers (stagehand#2458), so
  # the page list is complete after this settles.
  t.stagehand.browser.context.active_page

  pages = t.stagehand.browser.context.pages
  page1 = pages[0]
  page2 = pages[1]

  # v3 used schemaless extract; v4 requires a schema.
  schema = {
    "type" => "object",
    "properties" => { "extraction" => { "type" => "string" } },
    "required" => ["extraction"],
    "additionalProperties" => false,
  }

  # extract all the text from the first page
  extraction1 = t.stagehand.extract("extract the entire page text", schema: schema, page: page1).data
  # extract all the text from the second page
  extraction2 = t.stagehand.extract("extract the entire page text", schema: schema, page: page2).data

  extraction1_success = extraction1["extraction"].include?("Welcome!")
  extraction2_success = extraction2["extraction"].include?("You’re on the other page")

  { _success: extraction1_success && extraction2_success }
end
