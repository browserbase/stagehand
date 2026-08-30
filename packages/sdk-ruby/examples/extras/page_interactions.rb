# frozen_string_literal: true

# Core page/locator interactions without any LLM: navigation history, waiting,
# locator fill/type/click/readers, evaluate, and screenshot.
#
#   ruby examples/page_interactions.rb                # local Chrome
#   ruby examples/page_interactions.rb --browserbase  # Browserbase session

require_relative "example_helpers"

FORM_PAGE = <<~HTML
  data:text/html,
  <title>Ruby SDK interactions</title>
  <h1 id="ready">Order form</h1>
  <form>
    <input name="custname" placeholder="name">
    <input name="custtel" placeholder="phone">
    <input type="checkbox" id="cheese" value="cheese">
    <select name="size"><option>small</option><option>large</option></select>
  </form>
HTML

browser =
  if ARGV.include?("--browserbase")
    api_key = ExampleHelpers.env("BROWSERBASE_API_KEY") or abort "Set BROWSERBASE_API_KEY."
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: api_key)
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

begin
  stagehand = Stagehand.create(browser: browser, log_level: "warn")
  begin
    page = browser.context.active_page || browser.context.pages.first

    page.goto(FORM_PAGE.gsub("\n", ""))
    page.wait_for_selector("#ready", state: "visible")
    puts "title    -> #{page.title.inspect}"

    name = page.locator('input[name="custname"]')
    name.fill("Stagehand Ruby")
    name_locator_value = name.input_value
    puts "fill     -> custname=#{name_locator_value.inspect}"

    phone = page.locator('input[name="custtel"]')
    phone.type("555-0100", delay: 5)
    puts "type     -> custtel=#{phone.input_value.inspect}"

    cheese = page.locator("#cheese")
    puts "checkbox -> before=#{cheese.checked?}"
    cheese.click
    puts "checkbox -> after=#{cheese.checked?}"

    puts "count    -> #{page.locator("input").count} inputs, h1 text=#{page.locator("h1").text_content.inspect}"
    puts "evaluate -> #{page.evaluate("document.querySelector('form').elements.length")} form elements"

    page.wait_for_timeout(100)
    shot_path = File.join(Dir.tmpdir, "stagehand-ruby-interactions.png")
    bytes = page.screenshot(path: shot_path, full_page: true)
    puts "screenshot -> #{bytes.bytesize} bytes at #{shot_path}"

    page.goto("https://example.com")
    page.go_back
    puts "history  -> back on #{page.url.inspect}"
    page.go_forward
    puts "history  -> forward to #{page.url.inspect}"
    page.reload
    puts "reload   -> ok"
  ensure
    stagehand.close
  end
ensure
  browser.close
end
puts "Closed."
