# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/multi_tab.ts

Evals.define_task("multi_tab") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/")

  # v3-parity form: activePage() polls until Chrome's active target
  # registers (stagehand#2458), and act resolves its target through it,
  # so back-to-back tab-opening acts chain without explicit waits.
  t.stagehand.act("click the button to open the other page")
  t.stagehand.act("click the button to open the other page")
  t.stagehand.act("click the button to open the other page")
  t.stagehand.act("click the button to open the other page")
  active_page = t.stagehand.browser.context.active_page
  raise "no active page after opening tabs" unless active_page

  current_page_url = active_page.url
  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page5.html"

  if current_page_url != expected_url
    next { _success: false, message: "expected URL does not match current URL" }
  end

  # try acting on the first page again
  pages = t.stagehand.browser.context.pages
  page1 = pages[0]
  t.stagehand.act("click the button to open the other page", page: page1)

  active_page = t.stagehand.browser.context.active_page
  raise "no active page after acting on page 1" unless active_page

  current_page_url = active_page.url
  expected_url = "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html"
  if current_page_url != expected_url
    next { _success: false, message: "expected URL does not match current URL" }
  end

  # Target the page the URL assertion just verified. Without { page },
  # extract resolves its own target through activePage() again, so a
  # focus change between the check and the extract would silently move
  # the assertion to another tab. v3 also used schemaless extract; v4
  # requires a schema. Single-word key to stay clear of the snake_case
  # wire-casing bug (#14).
  page2text = t.stagehand.extract(
    "extract the entire page text",
    schema: {
      "type" => "object",
      "properties" => { "extraction" => { "type" => "string" } },
      "required" => ["extraction"],
      "additionalProperties" => false,
    },
    page: active_page,
  ).data
  expected_page2text = "You've made it to page 2"

  if page2text["extraction"].include?(expected_page2text)
    next { _success: true }
  end

  {
    _success: false,
    message: "extracted page text: #{page2text["extraction"]} does not match expected page text: #{expected_page2text}",
  }
end
