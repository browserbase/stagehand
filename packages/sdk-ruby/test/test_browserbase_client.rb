# frozen_string_literal: true

require_relative "test_helper"

require "socket"

require "stagehand/browserbase_client"

# HTTP-level tests against an in-process server (the session-orchestration
# tests in test_browserbase_session.rb use a fake client instead).
class TestBrowserbaseClient < Minitest::Test
  def test_session_logs_fetches_and_parses
    logs = [
      { "method" => "Input.dispatchMouseEvent", "pageId" => 0 },
      { "method" => "Network.requestWillBeSent", "pageId" => 0 },
    ]
    received, result = serve_once(status: "200 OK", body: JSON.generate(logs)) do |client|
      client.session_logs("sess 1")
    end

    assert_equal logs, result
    assert_includes received, "GET /v1/sessions/sess%201/logs"
    assert_includes received.downcase, "x-bb-api-key: key-1"
  end

  def test_session_logs_raises_on_http_error
    error = assert_raises(Stagehand::BrowserbaseSessionError) do
      serve_once(status: "404 Not Found", body: '{"error":"missing"}') do |client|
        client.session_logs("sess-unknown")
      end
    end
    assert_includes error.message, "404"
  end

  private

  # Boots a one-shot HTTP server, runs the block against a client pointed at
  # it, and returns [raw request head, block result].
  def serve_once(status:, body:)
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    received = nil
    thread = Thread.new do
      socket = server.accept
      head = []
      while (line = socket.gets) && line != "\r\n"
        head << line
      end
      received = head.join
      socket.write(
        "HTTP/1.1 #{status}\r\n" \
        "Content-Type: application/json\r\n" \
        "Content-Length: #{body.bytesize}\r\n" \
        "Connection: close\r\n\r\n#{body}",
      )
      socket.close
    end

    client = Stagehand::BrowserbaseClient.new(api_key: "key-1", base_url: "http://127.0.0.1:#{port}")
    result = yield client
    [received, result]
  ensure
    thread&.join(2)
    server&.close
  end
end
