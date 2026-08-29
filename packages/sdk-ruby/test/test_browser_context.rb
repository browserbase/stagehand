# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

require "pathname"
require "tempfile"

class TestBrowserContext < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    @context = Stagehand::BrowserContext.new(@rpc_client)
  end

  def teardown
    stop_rpc
  end

  def fake_page(page_id)
    Stagehand::Page.new(@rpc_client, Stagehand::Models::PageRef.from_wire({ "page_id" => page_id, "url" => "about:blank" }))
  end

  def test_close
    request = expect_rpc(result: { "closed" => true }) { assert_nil @context.close }
    assert_equal "context.close", request["method"]
    assert_equal({}, request["params"])
  end

  def test_add_init_script_from_string_and_pathname
    request = expect_rpc(result: { "ok" => true }) { assert_nil @context.add_init_script("window.z = 3") }
    assert_equal "context.add_init_script", request["method"]
    assert_equal({ "source" => "window.z = 3" }, request["params"])

    Tempfile.create(["init", ".js"]) do |file|
      file.write("window.q = 4")
      file.flush
      request = expect_rpc(result: { "ok" => true }) { @context.add_init_script(Pathname.new(file.path)) }
      assert_equal "window.q = 4\n//# sourceURL=#{file.path}", request["params"]["source"]
    end
  end

  def test_set_extra_http_headers
    request = expect_rpc(result: { "ok" => true }) { assert_nil @context.set_extra_http_headers("x-ctx" => "1") }
    assert_equal "context.set_extra_http_headers", request["method"]
    assert_equal({ "headers" => { "x-ctx" => "1" } }, request["params"])
  end

  def test_domain_policy_round_trip
    policy = { "allowed_domains" => ["example.com"], "blocked_domains" => [] }
    request = expect_rpc(result: policy) do
      assert_equal ["example.com"], @context.get_domain_policy.allowed_domains
    end
    assert_equal "context.get_domain_policy", request["method"]
    expect_rpc(result: nil) { assert_nil @context.get_domain_policy }

    request = expect_rpc(result: { "ok" => true }) do
      assert_nil @context.set_domain_policy(allowed_domains: ["example.com"])
    end
    assert_equal "context.set_domain_policy", request["method"]
    assert_equal({ "policy" => { "allowed_domains" => ["example.com"] } }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { @context.set_domain_policy(nil) }
    assert_equal({ "policy" => nil }, request["params"])

    assert_raises(ArgumentError) { @context.set_domain_policy("example.com") }
  end

  def test_cookies_with_and_without_urls
    cookie = { "name" => "sid", "value" => "1", "domain" => "example.com", "path" => "/",
               "expires" => -1, "http_only" => false, "secure" => true, "same_site" => "Lax" }
    request = expect_rpc(result: [cookie]) do
      cookies = @context.cookies
      assert_equal 1, cookies.size
      assert_equal "sid", cookies.first.name
    end
    assert_equal "context.cookies", request["method"]
    assert_equal({}, request["params"])

    request = expect_rpc(result: []) { @context.cookies("https://example.com") }
    assert_equal({ "urls" => "https://example.com" }, request["params"])

    request = expect_rpc(result: []) { @context.cookies(["https://example.com"]) }
    assert_equal({ "urls" => ["https://example.com"] }, request["params"])
  end

  def test_add_cookies_accepts_hashes_and_models
    request = expect_rpc(result: { "ok" => true }) do
      assert_nil @context.add_cookies([
        { name: "a", value: "1", url: "https://example.com" },
        Stagehand::Models::CookieParam.new(name: "b", value: "2", domain: "example.com", path: "/"),
      ])
    end
    assert_equal "context.add_cookies", request["method"]
    assert_equal(
      { "cookies" => [
        { "name" => "a", "value" => "1", "url" => "https://example.com" },
        { "name" => "b", "value" => "2", "domain" => "example.com", "path" => "/" },
      ] },
      request["params"],
    )
  end

  def test_clear_cookies_filters
    request = expect_rpc(result: { "ok" => true }) { assert_nil @context.clear_cookies }
    assert_equal "context.clear_cookies", request["method"]
    assert_equal({}, request["params"])

    request = expect_rpc(result: { "ok" => true }) do
      @context.clear_cookies(name: "sid", domain: /example\.(com|org)/i, path: /./m)
    end
    assert_equal(
      { "options" => {
        "name" => "sid",
        "domain" => { "source" => "example\\.(com|org)", "flags" => "i" },
        "path" => { "source" => ".", "flags" => "s" },
      } },
      request["params"],
    )

    assert_raises(ArgumentError) { @context.clear_cookies(name: /verbose/x) }
    assert_raises(ArgumentError) { @context.clear_cookies(name: 42) }
  end

  def test_clipboard_methods
    page = fake_page("page-9")

    request = expect_rpc(result: "hello") do
      assert_equal "hello", @context.clipboard.read_text(page: page)
    end
    assert_equal "context.clipboard_read_text", request["method"]
    assert_equal({ "page_id" => "page-9" }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { assert_nil @context.clipboard.write_text("hi") }
    assert_equal "context.clipboard_write_text", request["method"]
    assert_equal({ "text" => "hi" }, request["params"])

    request = expect_rpc(result: { "ok" => true }) { @context.clipboard.paste(page: page, shortcut: "Meta+V") }
    assert_equal "context.clipboard_paste", request["method"]
    assert_equal({ "page_id" => "page-9", "shortcut" => "Meta+V" }, request["params"])

    %w[clear copy cut].each do |action|
      request = expect_rpc(result: { "ok" => true }) { assert_nil @context.clipboard.public_send(action) }
      assert_equal "context.clipboard_#{action}", request["method"]
      assert_equal({}, request["params"])
    end
  end
end
