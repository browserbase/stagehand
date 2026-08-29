# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

class TestWebMCP < Minitest::Test
  include RPCHarness

  TOOL = {
    "name" => "add_to_cart",
    "description" => "Adds an item to the cart",
    "input_schema" => { "type" => "object" },
    "frame_id" => "frame-1",
    "backend_node_id" => 7,
  }.freeze

  INVOCATION = {
    "invocation_id" => "inv-1",
    "tool_name" => "add_to_cart",
    "frame_id" => "frame-1",
    "input" => { "sku" => "42" },
  }.freeze

  def setup
    start_rpc
    ref = Stagehand::Models::PageRef.from_wire({ "page_id" => "page-1", "url" => "about:blank" })
    @page = Stagehand::Page.new(@rpc_client, ref)
  end

  def teardown
    stop_rpc
  end

  def test_tools_lists_webmcp_tools
    request = expect_rpc(result: { "tools" => [TOOL] }) do
      tools = @page.tools(timeout: 500)
      assert_equal 1, tools.size
      tool = tools.first
      assert_equal "add_to_cart", tool.name
      assert_equal "Adds an item to the cart", tool.description
      assert_equal({ "type" => "object" }, tool.input_schema)
      assert_equal "frame-1", tool.frame_id
      assert_equal 7, tool.backend_node_id
    end
    assert_equal "page.webmcp_tools", request["method"]
    assert_equal({ "page_id" => "page-1", "options" => { "timeout" => 500 } }, request["params"])
  end

  def test_invoke_result_and_cancel
    tool = nil
    expect_rpc(result: { "tools" => [TOOL] }) { tool = @page.tools.first }

    invocation = nil
    request = expect_rpc(result: INVOCATION) { invocation = tool.invoke(input: { "sku" => "42" }) }
    assert_equal "page.webmcp_invoke_tool", request["method"]
    assert_equal(
      { "page_id" => "page-1", "frame_id" => "frame-1", "tool_name" => "add_to_cart", "input" => { "sku" => "42" } },
      request["params"],
    )
    assert_equal "inv-1", invocation.invocation_id
    assert_equal({ "sku" => "42" }, invocation.input)

    request = expect_rpc(result: { "invocation_id" => "inv-1", "status" => "Completed", "output" => { "ok" => true } }) do
      result = invocation.result(timeout: 1_000)
      assert_equal "Completed", result.status
      assert_equal({ "ok" => true }, result.output)
    end
    assert_equal "page.webmcp_invocation_result", request["method"]
    assert_equal(
      { "page_id" => "page-1", "invocation_id" => "inv-1", "options" => { "timeout" => 1_000 } },
      request["params"],
    )

    # Terminal result is memoized: no further RPC is issued.
    assert_equal "Completed", invocation.result.status

    request = expect_rpc(result: { "ok" => true }) { assert_nil invocation.cancel }
    assert_equal "page.webmcp_cancel_invocation", request["method"]
    assert_equal({ "page_id" => "page-1", "invocation_id" => "inv-1" }, request["params"])
  end

  def test_invoke_defaults_to_empty_input
    tool = nil
    expect_rpc(result: { "tools" => [TOOL] }) { tool = @page.tools.first }
    request = expect_rpc(result: INVOCATION) { tool.invoke }
    assert_equal({}, request["params"]["input"])
  end
end
