# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

require "tempfile"

class TestLocator < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    @locator = Stagehand::Locator.new(@rpc_client, page_id: "page-1", selector: "#login")
  end

  def teardown
    stop_rpc
  end

  def test_click_sends_descriptor_without_options
    request = expect_rpc(result: { "clicked" => true }) do
      assert_nil @locator.click
    end
    assert_equal "locator.click", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#login" }, request["params"])
  end

  def test_click_with_options
    request = expect_rpc(result: { "clicked" => true }) do
      @locator.click(button: "right", click_count: 2)
    end
    assert_equal(
      { "page_id" => "page-1", "selector" => "#login",
        "options" => { "button" => "right", "click_count" => 2 } },
      request["params"],
    )
  end

  def test_fill
    request = expect_rpc(result: { "filled" => true }) do
      assert_nil @locator.fill("user@example.com")
    end
    assert_equal "locator.fill", request["method"]
    assert_equal(
      { "page_id" => "page-1", "selector" => "#login", "value" => "user@example.com" },
      request["params"],
    )
  end

  def test_type_with_delay
    request = expect_rpc(result: { "typed" => true }) do
      @locator.type("hello", delay: 25)
    end
    assert_equal "locator.type", request["method"]
    assert_equal(
      { "page_id" => "page-1", "selector" => "#login", "text" => "hello",
        "options" => { "delay" => 25 } },
      request["params"],
    )
  end

  def test_scalar_readers_return_raw_results
    request = expect_rpc(result: 3) { assert_equal 3, @locator.count }
    assert_equal "locator.count", request["method"]

    request = expect_rpc(result: "Sign in") { assert_equal "Sign in", @locator.text_content }
    assert_equal "locator.text_content", request["method"]

    request = expect_rpc(result: "inner") { assert_equal "inner", @locator.inner_text }
    assert_equal "locator.inner_text", request["method"]

    request = expect_rpc(result: "abc") { assert_equal "abc", @locator.input_value }
    assert_equal "locator.input_value", request["method"]

    request = expect_rpc(result: true) { assert_equal true, @locator.visible? }
    assert_equal "locator.is_visible", request["method"]

    request = expect_rpc(result: false) { assert_equal false, @locator.checked? }
    assert_equal "locator.is_checked", request["method"]
  end

  def test_python_style_aliases
    expect_rpc(result: true) { assert_equal true, @locator.is_visible }
    expect_rpc(result: true) { assert_equal true, @locator.is_checked }
  end

  def test_nth_and_first_return_new_locators_with_index
    third = @locator.nth(2)
    refute_same @locator, third
    assert_equal 2, third.nth_index
    assert_nil @locator.nth_index
    assert_equal 0, @locator.first.nth_index

    request = expect_rpc(result: 1) { third.count }
    assert_equal({ "page_id" => "page-1", "selector" => "#login", "nth" => 2 }, request["params"])
  end

  def test_hover_and_scroll_to
    request = expect_rpc(result: { "hovered" => true }) { assert_nil @locator.hover }
    assert_equal "locator.hover", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#login" }, request["params"])

    request = expect_rpc(result: { "scrolled" => true }) { assert_nil @locator.scroll_to(50) }
    assert_equal "locator.scroll_to", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#login", "percent" => 50 }, request["params"])

    request = expect_rpc(result: { "scrolled" => true }) { @locator.scroll_to("75%") }
    assert_equal "75%", request["params"]["percent"]
  end

  def test_inner_html
    request = expect_rpc(result: "<b>hi</b>") { assert_equal "<b>hi</b>", @locator.inner_html }
    assert_equal "locator.inner_html", request["method"]
  end

  def test_centroid
    request = expect_rpc(result: { "x" => 10.5, "y" => 20 }) do
      centroid = @locator.centroid
      assert_equal 10.5, centroid.x
      assert_equal 20, centroid.y
    end
    assert_equal "locator.centroid", request["method"]
  end

  def test_highlight_with_colors
    request = expect_rpc(result: { "highlighted" => true }) { assert_nil @locator.highlight }
    assert_equal "locator.highlight", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#login" }, request["params"])

    request = expect_rpc(result: { "highlighted" => true }) do
      @locator.highlight(duration_ms: 500, border_color: { r: 255, g: 0, b: 0 },
                         content_color: Stagehand::Models::RgbaColor.new(r: 0, g: 0, b: 255, a: 0.2))
    end
    assert_equal(
      { "duration_ms" => 500,
        "border_color" => { "r" => 255, "g" => 0, "b" => 0 },
        "content_color" => { "r" => 0, "g" => 0, "b" => 255, "a" => 0.2 } },
      request["params"]["options"],
    )

    assert_raises(ArgumentError) { @locator.highlight(border_color: "red") }
  end

  def test_send_click_event
    request = expect_rpc(result: { "clicked" => true }) do
      assert_nil @locator.send_click_event(bubbles: true, detail: 1)
    end
    assert_equal "locator.send_click_event", request["method"]
    assert_equal({ "bubbles" => true, "detail" => 1 }, request["params"]["options"])
  end

  def test_select_option_accepts_string_or_array
    request = expect_rpc(result: ["large"]) do
      assert_equal ["large"], @locator.select_option("large")
    end
    assert_equal "locator.select_option", request["method"]
    assert_equal({ "page_id" => "page-1", "selector" => "#login", "values" => "large" }, request["params"])

    request = expect_rpc(result: %w[a b]) { @locator.select_option(%w[a b]) }
    assert_equal %w[a b], request["params"]["values"]
  end

  def test_set_input_files_encodes_payload
    Tempfile.create(["upload", ".txt"]) do |file|
      file.write("hello upload")
      file.flush
      request = expect_rpc(result: { "set" => true }) do
        assert_nil @locator.set_input_files(file.path)
      end
      assert_equal "locator.set_input_files", request["method"]
      files = request["params"]["files"]
      assert_equal 1, files.length
      assert_equal File.basename(file.path), files.first["name"]
      assert_equal "hello upload", Base64.strict_decode64(files.first["data"])
      assert_kind_of Integer, files.first["last_modified"]
    end
  end
end
