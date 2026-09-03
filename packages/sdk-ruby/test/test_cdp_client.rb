# frozen_string_literal: true

require_relative "test_helper"
require "stagehand/cdp_client"

# Drives CDPClient against a fake WebSocket to prove the attach flow, response
# routing, bindingCalled filtering, and version negotiation without a browser.
class FakeWebSocket
  attr_reader :sent

  def initialize
    @sent = Thread::Queue.new
    @frames = Thread::Queue.new
    @closed = false
  end

  def send_text(text)
    @sent << JSON.parse(text)
  end

  def recv
    frame = @frames.pop
    raise Stagehand::CDPConnectionClosedError if frame.equal?(:closed)
    frame
  end

  def push(message)
    @frames << JSON.generate(message)
  end

  def next_sent(timeout: 2)
    value = @sent.pop(timeout: timeout)
    raise "no CDP command sent" if value.nil?
    value
  end

  def close
    return if @closed
    @closed = true
    @frames << :closed
  end

  def closed?
    @closed
  end
end

class TestCDPClient < Minitest::Test
  def setup
    @socket = FakeWebSocket.new
    @client = Stagehand::CDPClient.new(@socket, "ws://fake/devtools/browser/1")
  end

  def teardown
    @client.close
  end

  def test_send_command_routes_response_by_id
    responder = Thread.new do
      command = @socket.next_sent
      assert_equal "Target.getTargets", command["method"]
      @socket.push({ "id" => command["id"], "result" => { "targetInfos" => [] } })
    end
    result = @client.send_command("Target.getTargets")
    responder.join
    assert_equal({ "targetInfos" => [] }, result)
  end

  def test_send_command_surfaces_cdp_errors
    responder = Thread.new do
      command = @socket.next_sent
      @socket.push({ "id" => command["id"], "error" => { "code" => -32_601, "message" => "not found" } })
    end
    error = assert_raises(Stagehand::CDPError) { @client.send_command("Extensions.loadUnpacked") }
    responder.join
    assert_equal(-32_601, error.code)
    assert_match(/not found/, error.message)
  end

  def test_attach_flow_and_binding_payload_filtering
    session_id = "session-abc"
    responder = Thread.new do
      loop do
        command = @socket.next_sent(timeout: 5)
        case command["method"]
        when "Extensions.loadUnpacked"
          @socket.push({ "id" => command["id"], "result" => { "id" => "ext-1" } })
        when "Target.getTargets"
          @socket.push({ "id" => command["id"], "result" => { "targetInfos" => [
            { "type" => "page", "url" => "about:blank", "targetId" => "t0", "title" => "" },
            { "type" => "service_worker",
              "url" => "chrome-extension://ext-1/service-worker.js",
              "targetId" => "t1", "title" => "Stagehand" },
          ] } })
        when "Target.attachToTarget"
          assert_equal({ "targetId" => "t1", "flatten" => true }, command["params"])
          @socket.push({ "id" => command["id"], "result" => { "sessionId" => session_id } })
        when "Runtime.enable"
          @socket.push({ "id" => command["id"], "result" => {} })
        when "Runtime.addBinding"
          assert_equal "__stagehandSendToHost", command.dig("params", "name")
          assert_equal session_id, command["sessionId"]
          @socket.push({ "id" => command["id"], "result" => {} })
        when "Runtime.evaluate"
          @socket.push({ "id" => command["id"], "result" => { "result" => { "value" => {
            "hasReceiver" => true,
            "marker" => {
              "protocolVersion" => Stagehand::STAGEHAND_PROTOCOL_VERSION,
              "serverInfo" => { "name" => "stagehand", "version" => "1.0.0" },
            },
          } } } })
          break
        end
      end
    end

    @client.attach(
      extension_dir: "/tmp/ext",
      extension_id: nil,
      preloaded_extension: false,
      service_worker_url_includes: "service-worker.js",
      deadline: Stagehand::Deadline.new(5),
    )
    responder.join
    assert_equal "ext-1", @client.service_worker.extension_id

    # Payloads for other sessions or bindings must be ignored.
    @socket.push({ "method" => "Runtime.bindingCalled", "sessionId" => "other",
                   "params" => { "name" => "__stagehandSendToHost", "payload" => "wrong", "executionContextId" => 1 } })
    @socket.push({ "method" => "Runtime.bindingCalled", "sessionId" => session_id,
                   "params" => { "name" => "someOtherBinding", "payload" => "wrong", "executionContextId" => 1 } })
    @socket.push({ "method" => "Runtime.bindingCalled", "sessionId" => session_id,
                   "params" => { "name" => "__stagehandSendToHost", "payload" => "right", "executionContextId" => 1 } })
    assert_equal "right", @client.receive
  end

  def test_negotiate_runtime
    negotiate = ->(marker) { Stagehand::CDPClient.negotiate_runtime(marker) }
    version = Stagehand::STAGEHAND_PROTOCOL_VERSION

    ok, = negotiate.call({ "protocolVersion" => version, "serverInfo" => { "name" => "stagehand" } })
    assert ok
    refute negotiate.call(nil).first
    refute negotiate.call({ "protocolVersion" => version, "serverInfo" => { "name" => "other" } }).first
    refute negotiate.call({ "protocolVersion" => 7, "serverInfo" => { "name" => "stagehand" } }).first
  end

  def test_protocol_compatibility_rules
    compat = ->(client, server) { Stagehand::CDPClient.protocol_compatibility(client, server) }
    assert_nil compat.call("1.0.0", "1.0.0")
    assert_nil compat.call("1.1.0", "1.2.5")
    assert_match(/older than client/, compat.call("1.2.0", "1.1.9"))
    assert_match(/major mismatch/, compat.call("1.0.0", "2.0.0"))
    assert_match(/prereleases must match/, compat.call("1.0.0-alpha.1", "1.0.0-alpha.2"))
    assert_nil compat.call("1.0.0-alpha.1", "1.0.0-alpha.1")
    assert_match(/invalid protocol version/, compat.call("nope", "1.0.0"))
  end

  def test_close_rejects_pending_and_receive
    pending = Thread.new do
      assert_raises(Stagehand::CDPConnectionClosedError) { @client.send_command("Target.getTargets") }
    end
    @socket.next_sent
    @client.close
    pending.join
    assert_raises(Stagehand::CDPConnectionClosedError) { @client.receive }
    assert @socket.closed?
  end
end
