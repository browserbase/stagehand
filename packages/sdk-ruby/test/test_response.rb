# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

require "base64"

class TestResponse < Minitest::Test
  include RPCHarness

  DESCRIPTOR = {
    "response_id" => "resp-1",
    "url" => "https://example.com/",
    "status" => 204,
    "status_text" => "No Content",
    "headers" => { "content-type" => "application/json" },
    "from_service_worker" => false,
  }.freeze

  def setup
    start_rpc
    descriptor = Stagehand::Models::NavigationResponseDescriptor.from_wire(DESCRIPTOR)
    @response = Stagehand::Response.new(@rpc_client, descriptor)
  end

  def teardown
    stop_rpc
  end

  def test_descriptor_readers
    assert_equal "https://example.com/", @response.url
    assert_equal 204, @response.status
    assert_equal "No Content", @response.status_text
    assert_predicate @response, :ok?
    assert_equal({ "content-type" => "application/json" }, @response.headers)
    refute @response.from_service_worker?
  end

  def test_all_headers
    request = expect_rpc(result: { "headers" => { "x-a" => "1" } }) do
      assert_equal({ "x-a" => "1" }, @response.all_headers)
    end
    assert_equal "response.all_headers", request["method"]
    assert_equal({ "response_id" => "resp-1" }, request["params"])
  end

  def test_headers_array_and_header_value_join_duplicates
    headers = [
      { "name" => "Set-Cookie", "value" => "a=1" },
      { "name" => "set-cookie", "value" => "b=2" },
      { "name" => "content-type", "value" => "text/html" },
    ]
    request = expect_rpc(result: { "headers" => headers }) do
      assert_equal headers.map { |h| { "name" => h["name"], "value" => h["value"] } }, @response.headers_array
    end
    assert_equal "response.headers_array", request["method"]

    expect_rpc(result: { "headers" => headers }) do
      assert_equal %w[a=1 b=2], @response.header_values("SET-COOKIE")
    end
    expect_rpc(result: { "headers" => headers }) do
      assert_equal "a=1, b=2", @response.header_value("set-cookie")
    end
    expect_rpc(result: { "headers" => headers }) do
      assert_nil @response.header_value("x-missing")
    end
  end

  def test_security_details_and_server_addr
    details = { "issuer" => "CA", "protocol" => "TLS 1.3", "subject_name" => "example.com",
                "valid_from" => 1, "valid_to" => 2 }
    request = expect_rpc(result: { "value" => details }) do
      assert_equal "CA", @response.security_details.issuer
    end
    assert_equal "response.security_details", request["method"]
    expect_rpc(result: { "value" => nil }) { assert_nil @response.security_details }

    request = expect_rpc(result: { "value" => { "ip_address" => "93.184.216.34", "port" => 443 } }) do
      assert_equal 443, @response.server_addr.port
    end
    assert_equal "response.server_addr", request["method"]
    expect_rpc(result: { "value" => nil }) { assert_nil @response.server_addr }
  end

  def test_body_text_and_json
    payload = JSON.generate({ "answer" => 42 })
    result = { "body" => Base64.strict_encode64(payload), "base64_encoded" => true }
    request = expect_rpc(result: result) { assert_equal payload, @response.body }
    assert_equal "response.body", request["method"]

    expect_rpc(result: result) { assert_equal payload, @response.text }
    expect_rpc(result: result) { assert_equal({ "answer" => 42 }, @response.json) }
  end

  def test_body_rejects_invalid_base64
    expect_rpc(result: { "body" => "not base64!!", "base64_encoded" => true }) do
      error = assert_raises(Stagehand::StagehandError) { @response.body }
      assert_equal "response.body returned invalid base64", error.message
    end
  end

  def test_finished
    expect_rpc(result: { "error" => nil }) { assert_nil @response.finished }

    request = expect_rpc(result: { "error" => { "message" => "net::ERR_ABORTED" } }) do
      error = @response.finished
      assert_instance_of Stagehand::StagehandError, error
      assert_equal "net::ERR_ABORTED", error.message
    end
    assert_equal "response.finished", request["method"]
  end
end
