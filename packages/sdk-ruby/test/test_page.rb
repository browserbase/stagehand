# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

require "tempfile"

class TestPage < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    ref = Stagehand::Models::PageRef.from_wire({ "page_id" => "page-1", "url" => "about:blank" })
    @page = Stagehand::Page.new(@rpc_client, ref)
  end

  def teardown
    stop_rpc
  end

  NAVIGATION_RESULT = {
    "page" => { "page_id" => "page-1", "url" => "https://example.com" },
    "response" => nil,
  }.freeze

  def test_click_with_and_without_options
    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.click(10, 20) }
    assert_equal "page.click", request["method"]
    assert_equal({ "page_id" => "page-1", "x" => 10, "y" => 20 }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { @page.click(10, 20, button: "middle", click_count: 2) }
    assert_equal({ "button" => "middle", "click_count" => 2 }, request["params"]["options"])
  end

  def test_hover_and_scroll
    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.hover(5, 6) }
    assert_equal "page.hover", request["method"]
    assert_equal({ "page_id" => "page-1", "x" => 5, "y" => 6 }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.scroll(0, 0, 0, 300) }
    assert_equal "page.scroll", request["method"]
    assert_equal({ "page_id" => "page-1", "x" => 0, "y" => 0, "delta_x" => 0, "delta_y" => 300 }, request["params"])
  end

  def test_type_and_key_press
    request = expect_rpc(result: { "ok" => true }) { @page.type("hello", delay: 10) }
    assert_equal "page.type", request["method"]
    assert_equal({ "page_id" => "page-1", "text" => "hello", "options" => { "delay" => 10 } }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { @page.key_press("Enter") }
    assert_equal "page.key_press", request["method"]
    assert_equal({ "page_id" => "page-1", "key" => "Enter" }, request["params"])
  end

  def test_evaluate_returns_raw_json_value
    request = expect_rpc(result: { "value" => { "answer" => 42 } }) do
      assert_equal({ "answer" => 42 }, @page.evaluate("({answer: 42})"))
    end
    assert_equal "page.evaluate", request["method"]
    assert_equal({ "page_id" => "page-1", "expression" => "({answer: 42})" }, request["params"])
  end

  def test_screenshot_decodes_base64_and_writes_path
    png = "\x89PNG fake bytes".b
    Tempfile.create(["shot", ".png"]) do |file|
      request = expect_rpc(result: { "data" => Base64.strict_encode64(png) }) do
        assert_equal png, @page.screenshot(path: file.path, full_page: true)
      end
      assert_equal "page.screenshot", request["method"]
      assert_equal({ "full_page" => true }, request["params"]["options"])
      assert_equal png, File.binread(file.path)
    end
  end

  def test_screenshot_mask_encodes_locator_descriptors
    locator = Stagehand::Locator.new(@rpc_client, page_id: "page-1", selector: ".secret").nth(1)
    request = expect_rpc(result: { "data" => Base64.strict_encode64("img") }) do
      @page.screenshot(mask: [locator])
    end
    assert_equal(
      [{ "page_id" => "page-1", "selector" => ".secret", "nth" => 1 }],
      request["params"]["options"]["mask"],
    )
  end

  def test_navigation_methods
    request = expect_rpc(result: NAVIGATION_RESULT) { @page.reload(ignore_cache: true) }
    assert_equal "page.reload", request["method"]
    assert_equal({ "page_id" => "page-1", "options" => { "ignore_cache" => true } }, request["params"])

    request = expect_rpc(result: NAVIGATION_RESULT) { @page.go_back }
    assert_equal "page.go_back", request["method"]

    request = expect_rpc(result: NAVIGATION_RESULT) { @page.go_forward(wait_until: "load") }
    assert_equal "page.go_forward", request["method"]
    assert_equal({ "wait_until" => "load" }, request["params"]["options"])
  end

  def test_wait_helpers
    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.wait_for_load_state("networkidle", timeout: 5_000) }
    assert_equal "page.wait_for_load_state", request["method"]
    assert_equal({ "page_id" => "page-1", "state" => "networkidle", "timeout" => 5_000 }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.wait_for_timeout(250) }
    assert_equal "page.wait_for_timeout", request["method"]
    assert_equal({ "page_id" => "page-1", "ms" => 250 }, request["params"])

    request = expect_rpc(result: { "matched" => true }) do
      assert_equal true, @page.wait_for_selector("#done", state: "visible")
    end
    assert_equal "page.wait_for_selector", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#done", "options" => { "state" => "visible" } }, request["params"])
  end

  def test_locator_factory_binds_page_id
    locator = @page.locator("#login")
    assert_instance_of Stagehand::Locator, locator
    assert_equal "page-1", locator.page_id
    assert_equal "#login", locator.selector
  end
end
