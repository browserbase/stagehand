# frozen_string_literal: true

# Ruby port of packages/sdk-python/examples/file_upload.py. No LLM involved —
# this exercises locator.set_input_files + page.evaluate only.
#
#   ruby examples/file_upload.rb                # local Chrome
#   ruby examples/file_upload.rb --browserbase  # Browserbase session

require "tmpdir"

require_relative "../lib/stagehand"

Dir.mktmpdir("stagehand-upload-") do |directory|
  file_path = File.join(directory, "hello.txt")
  File.write(file_path, "hello from Ruby")

  browser =
    if ARGV.include?("--browserbase")
      puts "Creating a Browserbase session..."
      Stagehand::Browserbase.launch(api_key: ENV.fetch("BROWSERBASE_API_KEY"))
    else
      puts "Launching local Chrome..."
      Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
    end

  begin
    stagehand = Stagehand.create(browser: browser, log_level: "warn")
    begin
      page = browser.context.active_page || browser.context.pages.first

      page.goto('data:text/html,<input id="upload" type="file">')
      page.locator("#upload").set_input_files(file_path)

      uploaded = page.evaluate(<<~JS)
        (async () => {
          const file = document.querySelector('#upload').files[0];
          return file ? { name: file.name, text: await file.text() } : null;
        })()
      JS
      expected = { "name" => "hello.txt", "text" => "hello from Ruby" }
      raise "Unexpected uploaded file: #{uploaded.inspect}" unless uploaded == expected
      puts uploaded.inspect
    ensure
      stagehand.close
    end
  ensure
    browser.close
  end
end
