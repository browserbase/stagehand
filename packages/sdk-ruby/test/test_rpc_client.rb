# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"
require "stagehand/rpc_client"

class TestRPCClient < Minitest::Test
  def setup
    @transport = FakeTransport.new
    @client = Stagehand::RPCClient.new(@transport)
  end

  def teardown
    @client.close
  end

  def respond_to_next_request(&build_response)
    Thread.new do
      request = @transport.next_sent
      @transport.push(build_response.call(request))
    end
  end

  # Inbound work (notifications, requests) is dispatched asynchronously.
  def wait_until(timeout: 2)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    until yield
      flunk "condition not met within #{timeout}s" if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
      sleep 0.005
    end
  end

  LLM_REQUEST = {
    "jsonrpc" => "2.0", "id" => 11, "method" => "llm.generate",
    "params" => {
      "messages" => [{ "role" => "user", "content" => { "type" => "text", "text" => "hi" } }],
      "response_format" => { "type" => "json_schema", "name" => "extract", "schema" => { "type" => "object" } },
    },
  }.freeze

  def structured_result(text: "{}", structured_content: {})
    Stagehand::Models::LLMStructuredGenerateResult.new(
      role: "assistant",
      content: Stagehand::Models::LLMTextContent.new(type: "text", text: text),
      output_format: "json_schema",
      structured_content: structured_content,
    )
  end

  def test_request_response_round_trip
    responder = respond_to_next_request do |request|
      assert_equal "2.0", request["jsonrpc"]
      assert_equal "context.pages", request["method"]
      assert_equal({}, request["params"])
      {
        "jsonrpc" => "2.0",
        "id" => request["id"],
        "result" => [{ "page_id" => "page-1", "url" => "https://example.com" }],
      }
    end
    result = @client.send("context.pages", Stagehand::Models::EmptyParams.new, "ContextPagesResult")
    responder.join
    assert_equal 1, result.size
    assert_instance_of Stagehand::Models::PageRef, result.first
    assert_equal "page-1", result.first.page_id
  end

  def test_error_response_raises_rpc_error
    responder = respond_to_next_request do |request|
      {
        "jsonrpc" => "2.0",
        "id" => request["id"],
        "error" => { "code" => -32_000, "message" => "boom", "data" => { "detail" => "x" } },
      }
    end
    error = assert_raises(Stagehand::RPCError) do
      @client.send("stagehand.metrics", Stagehand::Models::EmptyParams.new, "StagehandMetrics")
    end
    responder.join
    assert_equal(-32_000, error.code)
    assert_equal({ "detail" => "x" }, error.data)
    assert_equal "boom", error.message
  end

  def test_concurrent_requests_route_by_id
    results = Array.new(2)
    senders = 2.times.map do |index|
      Thread.new do
        results[index] = @client.send(
          "page.title",
          Stagehand::Models::PageIdParams.new(page_id: "page-#{index}"),
          "PageTitleResult",
        )
      end
    end
    requests = Array.new(2) { @transport.next_sent }
    # Answer out of order to prove responses route by id, not arrival order.
    requests.sort_by { |request| -request["id"] }.each do |request|
      page_id = request["params"].fetch("page_id")
      @transport.push({ "jsonrpc" => "2.0", "id" => request["id"], "result" => "title for #{page_id}" })
    end
    senders.each(&:join)
    assert_equal ["title for page-0", "title for page-1"], results
  end

  def test_notifications_buffer_until_listener_registers
    @client.receive({ "jsonrpc" => "2.0", "method" => "stagehand.log",
                      "params" => { "level" => "info", "message" => "early", "data" => {} } })
    seen = []
    @client.on_notification("stagehand.log") { |log| seen << log }
    @client.receive({ "jsonrpc" => "2.0", "method" => "stagehand.log",
                      "params" => { "level" => "warn", "message" => "late", "data" => {} } })
    wait_until { seen.size == 2 }
    assert_equal %w[early late], seen.map(&:message)
    assert_instance_of Stagehand::Models::StagehandLog, seen.first
  end

  def test_inbound_request_without_handler_gets_method_not_found
    @client.receive({ "jsonrpc" => "2.0", "id" => 7, "method" => "llm.generate", "params" => {} })
    reply = @transport.next_sent
    assert_equal 7, reply["id"]
    assert_equal(-32_601, reply.dig("error", "code"))
  end

  def test_on_request_round_trip
    seen = nil
    @client.on_request("llm.generate") do |params|
      seen = params
      structured_result(structured_content: { "greeting" => "hello" })
    end
    @client.receive(LLM_REQUEST.dup)
    reply = @transport.next_sent
    assert_equal 11, reply["id"]
    assert_equal(
      { "role" => "assistant", "content" => { "type" => "text", "text" => "{}" },
        "output_format" => "json_schema", "structured_content" => { "greeting" => "hello" } },
      reply["result"],
    )
    assert_instance_of Stagehand::Models::LLMStructuredGenerateParams, seen
    assert_equal "extract", seen.response_format.name
    assert_equal "hi", seen.messages.first.content.text
  end

  def test_request_handler_may_issue_rpc_calls
    @client.on_request("llm.generate") do |_params|
      title = @client.send("page.title", Stagehand::Models::PageIdParams.new(page_id: "page-1"), "PageTitleResult")
      structured_result(structured_content: { "title" => title })
    end
    @client.receive(LLM_REQUEST.dup)
    inner = @transport.next_sent
    assert_equal "page.title", inner["method"]
    @transport.push({ "jsonrpc" => "2.0", "id" => inner["id"], "result" => "Example Domain" })
    reply = @transport.next_sent
    assert_equal 11, reply["id"]
    assert_equal "Example Domain", reply.dig("result", "structured_content", "title")
  end

  def test_request_handler_error_maps_to_internal_error_with_name
    @client.on_request("llm.generate") { raise "llm exploded" }
    @client.receive(LLM_REQUEST.dup)
    reply = @transport.next_sent
    assert_equal 11, reply["id"]
    assert_equal(-32_603, reply.dig("error", "code"))
    assert_equal "llm exploded", reply.dig("error", "message")
    assert_equal({ "name" => "RuntimeError" }, reply.dig("error", "data"))
  end

  def test_request_with_unmatched_union_params_gets_invalid_params
    @client.on_request("llm.generate") { |params| params }
    @client.receive({ "jsonrpc" => "2.0", "id" => 4, "method" => "llm.generate", "params" => { "foo" => 1 } })
    reply = @transport.next_sent
    assert_equal 4, reply["id"]
    assert_equal(-32_602, reply.dig("error", "code"))
  end

  def test_invalid_handler_result_maps_to_internal_error
    @client.on_request("llm.generate") { { "bogus" => true } }
    @client.receive(LLM_REQUEST.dup)
    reply = @transport.next_sent
    assert_equal(-32_603, reply.dig("error", "code"))
    assert_equal "Internal error", reply.dig("error", "message")
  end

  def test_on_request_remove_restores_method_not_found
    remove = @client.on_request("llm.generate") { structured_result }
    replaced = @client.on_request("llm.generate") { structured_result }
    remove.call # stale removal is a no-op: the second registration stays
    @client.receive(LLM_REQUEST.dup)
    assert_equal 11, @transport.next_sent["id"]
    replaced.call
    @client.receive(LLM_REQUEST.merge("id" => 12))
    reply = @transport.next_sent
    assert_equal 12, reply["id"]
    assert_equal(-32_601, reply.dig("error", "code"))
  end

  def test_on_request_after_close_raises
    @client.close
    assert_raises(Stagehand::StagehandError) { @client.on_request("llm.generate") { nil } }
  end

  def test_malformed_json_gets_parse_error
    @client.receive("{nope")
    reply = @transport.next_sent
    assert_nil reply["id"]
    assert_equal(-32_700, reply.dig("error", "code"))
  end

  def test_invalid_request_gets_invalid_request_error
    @client.receive({ "jsonrpc" => "2.0", "id" => "not-an-int", "method" => "x" })
    reply = @transport.next_sent
    assert_nil reply["id"]
    assert_equal(-32_600, reply.dig("error", "code"))
  end

  def test_close_rejects_pending_requests
    sender = Thread.new do
      @client.send("stagehand.metrics", Stagehand::Models::EmptyParams.new, "StagehandMetrics")
    end
    @transport.next_sent
    @client.close
    error = assert_raises(Stagehand::StagehandError) { sender.join.value }
    assert_match(/closed/i, error.message)
    assert @transport.closed?
  end

  def test_timeout_table
    compute = ->(method, params) { Stagehand::RPCClient.response_timeout_seconds(method, params) }
    assert_nil compute.call("stagehand.act", {})
    assert_in_delta 15.0, compute.call("stagehand.act", { "options" => { "timeout" => 5_000 } })
    assert_in_delta 25.0, compute.call("page.goto", {})
    assert_in_delta 12.0, compute.call("page.wait_for_load_state", { "timeout" => 2_000 })
    assert_in_delta 11.0, compute.call("page.wait_for_timeout", { "ms" => 1_000 })
    assert_nil compute.call("locator.click", {})
    assert_in_delta 10.0, compute.call("context.pages", {})
  end
end
