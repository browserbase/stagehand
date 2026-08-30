# frozen_string_literal: true

# Deterministic tour of the context/response surface — no LLM calls:
#   1. navigation Response: status, headers, body
#   2. context: init script, cookies (add/read/clear), extra headers
#   3. clipboard write/read
#   4. page: viewport size, accessibility snapshot, console event
#
#   ruby examples/context_and_response.rb                # local Chrome
#   ruby examples/context_and_response.rb --browserbase  # Browserbase session

require_relative "../../lib/stagehand"
require_relative "example_helpers"

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
    context = browser.context
    page = context.active_page || context.pages.first

    context.add_init_script("globalThis.__initScriptRan = true")

    response = page.goto("https://example.com")
    puts "response  -> #{response.status} #{response.status_text} (ok=#{response.ok?})"
    puts "response  -> content-type: #{response.header_value("content-type").inspect}"
    puts "response  -> body: #{response.body.bytesize} bytes, finished=#{response.finished.inspect}"
    puts "initscript-> ran on navigation: #{page.evaluate("globalThis.__initScriptRan === true")}"

    context.add_cookies([{ name: "ruby_sdk", value: "m2", url: "https://example.com" }])
    cookies = context.cookies("https://example.com")
    puts "cookies   -> #{cookies.map { |c| "#{c.name}=#{c.value}" }.join(", ")}"
    context.clear_cookies(name: /^ruby_/)
    puts "cookies   -> after clear: #{context.cookies("https://example.com").size}"

    context.clipboard.write_text("hello from ruby")
    puts "clipboard -> #{context.clipboard.read_text.inspect}"

    page.set_viewport_size(1024, 768)
    puts "viewport  -> #{page.evaluate("`${window.innerWidth}x${window.innerHeight}`")}"

    snapshot = page.snapshot
    puts "snapshot  -> #{snapshot.formatted_tree.lines.size} tree lines, first: #{snapshot.formatted_tree.lines.first&.strip.inspect}"

    events = Thread::Queue.new
    subscription = page.on("console") { |event| events << event }
    page.evaluate('console.log("m2-live-check"); "ok"')
    event = events.pop(timeout: 10)
    puts "page.on   -> #{event ? event.method : "TIMED OUT"}"
    subscription.unsubscribe
  ensure
    stagehand.close
  end
ensure
  browser.close
end
puts "Closed."
