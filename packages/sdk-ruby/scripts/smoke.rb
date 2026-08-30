# frozen_string_literal: true

# Smoke test for the INSTALLED gem (the analogue of
# packages/sdk-python/scripts/smoke.py): requires "stagehand" from the load
# path — run it after `gem install dist/*.gem` — asserts the embedded
# extension is present, then drives a real local Chrome against a local
# fixture server. No LLM calls. CHROME_PATH selects the browser binary.

require "socket"
require "stagehand"

FIXTURE_BODY = "<!doctype html><html><title>Stagehand package smoke</title></html>"

def with_fixture_server
  server = TCPServer.new("127.0.0.1", 0)
  port = server.addr[1]
  thread = Thread.new do
    loop do
      client = server.accept
      begin
        request_line = client.gets
        client.gets until (line = client.gets).nil? || line == "\r\n" || line == "\n"
        next if request_line.nil?
        client.write(
          "HTTP/1.1 200 OK\r\n" \
          "Content-Type: text/html; charset=utf-8\r\n" \
          "Content-Length: #{FIXTURE_BODY.bytesize}\r\n" \
          "X-Stagehand-Fixture: ruby-navigation-response\r\n" \
          "Connection: close\r\n\r\n#{FIXTURE_BODY}",
        )
      ensure
        client.close
      end
    rescue IOError, Errno::EBADF
      break
    end
  end
  yield "http://127.0.0.1:#{port}"
ensure
  server&.close
  thread&.kill
end

extension_directory = Stagehand::ExtensionAssets.extension_directory
unless File.file?(File.join(extension_directory, "manifest.json"))
  abort "Installed Stagehand gem is missing its browser extension"
end
unless File.basename(extension_directory) == "_extension"
  abort "Extension resolved to #{extension_directory} instead of the embedded copy"
end

with_fixture_server do |fixture_url|
  browser = Stagehand::LocalBrowser.launch(headless: true)
  begin
    stagehand = Stagehand.create(browser: browser, log_level: "warn")
    begin
      page = browser.context.pages.first
      raise "Stagehand initialized without an active page" if page.nil?

      response = page.goto(fixture_url)
      raise "Unexpected navigation status: #{response&.status.inspect}" unless response&.status == 200
      fixture_header = response.header_value("x-stagehand-fixture")
      raise "Missing fixture header: #{fixture_header.inspect}" unless fixture_header == "ruby-navigation-response"
      title = page.title
      raise "Unexpected page title: #{title.inspect}" unless title == "Stagehand package smoke"

      puts "Gem smoke passed: #{Stagehand::VERSION} (extension at #{extension_directory})"
    ensure
      stagehand.close
    end
  ensure
    browser.close
  end
end
