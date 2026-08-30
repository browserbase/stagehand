# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

# Wire encoding of the AI operations' locator targeting options.
class TestClientOperations < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    @client = Stagehand::Client.allocate
    @client.instance_variable_set(:@rpc_client, @rpc_client)
    @client.instance_variable_set(:@initialized, true)
    @page = Stagehand::Page.new(
      @rpc_client,
      Stagehand::Models::PageRef.from_wire({ "page_id" => "page-1", "url" => "about:blank" }),
    )
  end

  def teardown
    stop_rpc
  end

  ACT_RESULT = {
    "data" => {
      "success" => true, "message" => "ok", "action_description" => "d",
      "actions" => [{ "selector" => "#a", "description" => "d", "method" => "click" }],
    },
    "metadata" => {
      "cache" => { "status" => "DISABLED" },
      "usage" => { "input_tokens" => 0, "output_tokens" => 0, "inference_time_ms" => 0 },
    },
  }.freeze

  def test_act_sends_locator_and_ignore_locators
    locator = @page.locator("#login").nth(2)
    ignored = [@page.locator("#banner")]
    request = expect_rpc(result: ACT_RESULT) do
      @client.act("click login", page: @page, locator: locator, ignore_locators: ignored)
    end
    assert_equal(
      { "locator" => { "selector" => "#login", "nth" => 2 },
        "ignore_locators" => [{ "selector" => "#banner" }] },
      request["params"]["options"],
    )
  end

  def test_extract_sends_locator
    request = expect_rpc(result: ACT_RESULT.merge("data" => {})) do
      @client.extract("extract it", page: @page, locator: @page.locator("xpath=/html/body/div"))
    end
    assert_equal({ "locator" => { "selector" => "xpath=/html/body/div" } }, request["params"]["options"])
  end

  def test_locator_must_belong_to_the_target_page
    other_page = Stagehand::Page.new(
      @rpc_client,
      Stagehand::Models::PageRef.from_wire({ "page_id" => "page-2", "url" => "about:blank" }),
    )
    error = assert_raises(ArgumentError) do
      @client.observe("find it", page: @page, locator: other_page.locator("#x"))
    end
    assert_equal "observe() locator must belong to the target page", error.message
  end
end
