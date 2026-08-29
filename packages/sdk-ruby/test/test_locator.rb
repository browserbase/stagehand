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
