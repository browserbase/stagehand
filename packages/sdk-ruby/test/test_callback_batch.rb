# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

class TestCallbackBatchExpression < Minitest::Test
  def test_callback_source_from_message
    assert_nil Stagehand::CDPClient.callback_source_from_message({ "method" => "page.goto", "params" => {} })

    message = { "method" => "stagehand.callback_batch", "params" => { "callback_source" => "(sh) => 1" } }
    assert_equal "(sh) => 1", Stagehand::CDPClient.callback_source_from_message(message)

    [{}, { "params" => {} }, { "params" => { "callback_source" => "  " } }].each do |body|
      error = assert_raises(Stagehand::StagehandError) do
        Stagehand::CDPClient.callback_source_from_message(body.merge("method" => "stagehand.callback_batch"))
      end
      assert_equal "Stagehand callback batch request is missing callback_source", error.message
    end
  end

  def test_callback_batch_expression_embeds_message_and_source
    message = {
      "jsonrpc" => "2.0", "id" => 7, "method" => "stagehand.callback_batch",
      "params" => { "callback_source" => "(sh) => sh.page.url()", "options" => { "timeout" => 30_000 } },
    }
    expression = Stagehand::CDPClient.callback_batch_expression(message, "(sh) => sh.page.url()")

    assert_includes expression, "globalThis.__stagehandReceiveFromHost("
    assert_includes expression, "{ callback: ((sh) => sh.page.url()) }"
    assert_includes expression, "const __name = (fn, name) =>"
    # The message rides along double-JSON-encoded, exactly like the sibling SDKs.
    assert_includes expression, JSON.generate(JSON.generate(message))
  end
end

class TestExperimentalBatch < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    # Client.new is private and needs a live browser; the batch surface only
    # needs a connected RPC client, so wire one in directly.
    @client = Stagehand::Client.allocate
    @client.instance_variable_set(:@rpc_client, @rpc_client)
    @client.instance_variable_set(:@initialized, true)
  end

  def teardown
    stop_rpc
  end

  def test_validations
    assert_raises(ArgumentError) { @client.experimental_batch("   ") }
    assert_raises(ArgumentError) { @client.experimental_batch(42) }
    assert_raises(ArgumentError) { @client.experimental_batch("(sh) => 1", timeout: 0) }
    assert_raises(ArgumentError) { @client.experimental_batch("(sh) => 1", timeout: 2.5) }
    assert_raises(ArgumentError) { @client.experimental_batch("(sh) => 1", timeout: 2_147_483_648) }
    assert_raises(ArgumentError) { @client.experimental_batch("(sh) => 1", Object.new) }
    assert_raises(ArgumentError) { @client.experimental_batch("(sh) => 1", { "a" => Float::NAN }) }
  end

  def test_sends_callback_batch_and_returns_raw_value
    request = expect_rpc(result: { "value" => { "url" => "about:blank" } }) do
      assert_equal({ "url" => "about:blank" }, @client.experimental_batch("(sh) => sh.page.url()"))
    end
    assert_equal "stagehand.callback_batch", request["method"]
    assert_equal(
      { "callback_source" => "(sh) => sh.page.url()", "options" => { "timeout" => 30_000 } },
      request["params"],
    )
  end

  def test_sends_input_and_page_target
    page = Stagehand::Page.new(
      @rpc_client,
      Stagehand::Models::PageRef.from_wire({ "page_id" => "page-3", "url" => "about:blank" }),
    )
    request = expect_rpc(result: { "value" => nil }) do
      assert_nil @client.experimental_batch("(sh, input) => input", [1, "two"], timeout: 5_000, page: page)
    end
    assert_equal(
      { "callback_source" => "(sh, input) => input",
        "input" => [1, "two"],
        "options" => { "timeout" => 5_000, "page_id" => "page-3" } },
      request["params"],
    )
  end
end
