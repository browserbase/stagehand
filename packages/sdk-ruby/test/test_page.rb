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
    request = expect_rpc(result: NAVIGATION_RESULT) { assert_nil @page.reload(ignore_cache: true) }
    assert_equal "page.reload", request["method"]
    assert_equal({ "page_id" => "page-1", "options" => { "ignore_cache" => true } }, request["params"])

    request = expect_rpc(result: NAVIGATION_RESULT) { assert_nil @page.go_back }
    assert_equal "page.go_back", request["method"]

    request = expect_rpc(result: NAVIGATION_RESULT) { @page.go_forward(wait_until: "load") }
    assert_equal "page.go_forward", request["method"]
    assert_equal({ "wait_until" => "load" }, request["params"]["options"])
  end

  def test_goto_returns_response_and_tracks_page_id
    result = {
      "page" => { "page_id" => "page-2", "url" => "https://example.com" },
      "response" => {
        "response_id" => "resp-1",
        "url" => "https://example.com/",
        "status" => 200,
        "status_text" => "OK",
        "headers" => { "content-type" => "text/html" },
        "from_service_worker" => false,
      },
    }
    request = expect_rpc(result: result) do
      response = @page.goto("https://example.com")
      assert_instance_of Stagehand::Response, response
      assert_equal 200, response.status
      assert_predicate response, :ok?
      assert_equal({ "content-type" => "text/html" }, response.headers)
    end
    assert_equal "page.goto", request["method"]
    assert_equal "page-2", @page.page_id
  end

  def test_drag_and_drop
    request = expect_rpc(result: { "ok" => true }) do
      assert_nil @page.drag_and_drop(1, 2, 3, 4, steps: 5, route: [{ x: 2, y: 3 }])
    end
    assert_equal "page.drag_and_drop", request["method"]
    assert_equal(
      { "page_id" => "page-1", "from_x" => 1, "from_y" => 2, "to_x" => 3, "to_y" => 4,
        "options" => { "steps" => 5, "route" => [{ "x" => 2, "y" => 3 }] } },
      request["params"],
    )
  end

  def test_add_init_script_from_string_and_pathname
    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.add_init_script("window.x = 1") }
    assert_equal "page.add_init_script", request["method"]
    assert_equal({ "page_id" => "page-1", "source" => "window.x = 1" }, request["params"])

    Tempfile.create(["init", ".js"]) do |file|
      file.write("window.y = 2")
      file.flush
      request = expect_rpc(result: { "ok" => true }) { @page.add_init_script(Pathname.new(file.path)) }
      assert_equal "window.y = 2\n//# sourceURL=#{file.path}", request["params"]["source"]
    end
  end

  def test_set_extra_http_headers_and_viewport_size
    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.set_extra_http_headers("x-test" => "1") }
    assert_equal "page.set_extra_http_headers", request["method"]
    assert_equal({ "page_id" => "page-1", "headers" => { "x-test" => "1" } }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { assert_nil @page.set_viewport_size(800, 600, device_scale_factor: 2) }
    assert_equal "page.set_viewport_size", request["method"]
    assert_equal(
      { "page_id" => "page-1", "width" => 800, "height" => 600, "options" => { "device_scale_factor" => 2 } },
      request["params"],
    )
  end

  def test_snapshot
    result = { "formatted_tree" => "- link", "xpath_map" => { "1" => "//a" }, "url_map" => {} }
    request = expect_rpc(result: result) do
      snapshot = @page.snapshot(include_iframes: true)
      assert_equal "- link", snapshot.formatted_tree
      assert_equal({ "1" => "//a" }, snapshot.xpath_map)
    end
    assert_equal "page.snapshot", request["method"]
    assert_equal({ "page_id" => "page-1", "options" => { "include_iframes" => true } }, request["params"])
  end

  def test_close
    request = expect_rpc(result: { "closed" => true }) { assert_nil @page.close }
    assert_equal "page.close", request["method"]
    assert_equal({ "page_id" => "page-1" }, request["params"])
  end

  CDP_EVENT = {
    "page_id" => "page-1",
    "method" => "Runtime.consoleAPICalled",
    "params" => { "type" => "log" },
    "session_id" => "session-1",
    "target_id" => "target-1",
  }.freeze

  def test_on_filters_by_subscription_id_and_unsubscribes
    events = Thread::Queue.new
    subscription = nil
    request = expect_rpc(result: { "ok" => true }) do
      subscription = @page.on("console") { |event| events << event }
    end
    assert_equal "page.on", request["method"]
    assert_equal "page-1", request["params"]["page_id"]
    assert_equal "console", request["params"]["event"]
    subscription_id = request["params"]["subscription_id"]
    assert_equal subscription_id, subscription.subscription_id

    other = { "jsonrpc" => "2.0", "method" => "page.cdp_event",
              "params" => { "subscription_id" => "someone-else", "event" => CDP_EVENT } }
    mine = { "jsonrpc" => "2.0", "method" => "page.cdp_event",
             "params" => { "subscription_id" => subscription_id, "event" => CDP_EVENT } }
    @transport.push(JSON.generate(other))
    @transport.push(JSON.generate(mine))

    event = events.pop(timeout: 2)
    refute_nil event
    assert_equal "Runtime.consoleAPICalled", event.method
    assert_equal({ "type" => "log" }, event.params)
    assert_equal 0, events.size

    request = expect_rpc(result: { "ok" => true }) { assert_nil subscription.unsubscribe }
    assert_equal "page.off", request["method"]
    assert_equal({ "subscription_id" => subscription_id }, request["params"])

    # A second unsubscribe is a local no-op (no page.off is sent).
    assert_nil subscription.unsubscribe
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
