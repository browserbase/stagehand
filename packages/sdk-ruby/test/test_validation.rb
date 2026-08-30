# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

class TestValidation < Minitest::Test
  Validation = Stagehand::Validation
  Models = Stagehand::Models

  def test_screenshot_cross_field_constraints
    error = assert_raises(ArgumentError) do
      Validation.screenshot_options!(full_page: true, clip: Models::PageScreenshotClip.new(x: 0, y: 0, width: 1, height: 1))
    end
    assert_equal "fullPage and clip cannot be used together", error.message

    error = assert_raises(ArgumentError) { Validation.screenshot_options!(quality: 80, type: "png") }
    assert_equal 'quality is only valid when type is "jpeg"', error.message
    error = assert_raises(ArgumentError) { Validation.screenshot_options!(quality: 80) }
    assert_equal 'quality is only valid when type is "jpeg"', error.message

    assert_nil Validation.screenshot_options!(quality: 80, type: "jpeg")
    assert_nil Validation.screenshot_options!(full_page: true)
    assert_nil Validation.screenshot_options!(clip: Models::PageScreenshotClip.new(x: 0, y: 0, width: 1, height: 1))
  end

  def test_telemetry_endpoint_must_end_with_v1_traces
    config = Validation.telemetry_config({ traces: { endpoint: "https://otel.example.com/v1/traces" } })
    assert_instance_of Models::TelemetryConfig, config
    assert_equal "https://otel.example.com/v1/traces", config.traces.endpoint

    error = assert_raises(ArgumentError) do
      Validation.telemetry_config({ traces: { endpoint: "https://otel.example.com/collector" } })
    end
    assert_equal "OTLP trace endpoint must end with /v1/traces", error.message

    assert_raises(ArgumentError) { Validation.telemetry_config({ traces: { endpoint: "http://exa mple/v1/traces" } }) }
    assert_raises(ArgumentError) { Validation.telemetry_config({}) }
    assert_raises(ArgumentError) { Validation.telemetry_config("otlp") }

    passthrough = Models::TelemetryConfig.new(traces: Models::TelemetryTraces.new(endpoint: "https://o.example/v1/traces"))
    assert_same passthrough, Validation.telemetry_config(passthrough)
  end

  def test_cache_config
    assert_equal true, Validation.cache_config(true)
    assert_equal false, Validation.cache_config(false)
    assert_equal({ "threshold" => 3 }, Validation.cache_config({ threshold: 3 }))
    assert_equal({ "threshold" => 3 }, Validation.cache_config({ "threshold" => 3 }))
    assert_equal({}, Validation.cache_config({}))
    assert_raises(ArgumentError) { Validation.cache_config({ threshold: 0 }) }
    assert_raises(ArgumentError) { Validation.cache_config({ threshold: 1.5 }) }
    assert_raises(ArgumentError) { Validation.cache_config({ ttl: 5 }) }
    assert_raises(ArgumentError) { Validation.cache_config("yes") }
  end

  def test_scalar_helpers
    assert_raises(ArgumentError) { Validation.nonempty_string!("", "api_key") }
    assert_raises(ArgumentError) { Validation.nonempty_string!(1, "api_key") }
    assert_raises(ArgumentError) { Validation.boolean!("true", "self_heal") }
    assert_raises(ArgumentError) { Validation.positive_integer!(0, "dom_settle_timeout_ms") }
    assert_raises(ArgumentError) { Validation.positive_integer!(9_007_199_254_740_992, "dom_settle_timeout_ms") }
    assert_raises(ArgumentError) { Validation.string_map!({ "a" => 1 }, "model_headers") }
    assert_nil Validation.string_map!({ "a" => "b", sym: "c" }, "model_headers")
  end

  def test_create_validates_inputs_before_claiming_the_browser
    browser = Stagehand::StagehandBrowser.allocate
    create = ->(**options) { Stagehand::Client.create(browser: browser, **options) }
    assert_raises(ArgumentError) { create.call(api_key: "") }
    assert_raises(ArgumentError) { create.call(api_url: 42) }
    assert_raises(ArgumentError) { create.call(self_heal: "yes") }
    assert_raises(ArgumentError) { create.call(dom_settle_timeout_ms: -1) }
    assert_raises(ArgumentError) { create.call(model: "openai/gpt-5-mini", model_headers: { "x" => 1 }) }
    assert_raises(ArgumentError) { create.call(telemetry: { traces: { endpoint: "https://x.example/wrong" } }) }
    assert_raises(ArgumentError) { create.call(cache: "always") }
  end
end

class TestScreenshotValidationWiring < Minitest::Test
  include RPCHarness

  def setup
    start_rpc
    @page = Stagehand::Page.new(
      @rpc_client,
      Stagehand::Models::PageRef.from_wire({ "page_id" => "page-1", "url" => "about:blank" }),
    )
  end

  def teardown
    stop_rpc
  end

  def test_screenshot_rejects_full_page_with_clip_without_sending
    assert_raises(ArgumentError) do
      @page.screenshot(full_page: true, clip: { x: 0, y: 0, width: 10, height: 10 })
    end
    assert_raises(ArgumentError) { @page.screenshot(quality: 80) }
    assert_nil @transport.sent.pop(timeout: 0.05)
  end

  def test_worker_init_values_carry_telemetry_and_cache
    client = Stagehand::Client.allocate
    client.instance_variable_set(:@config, {
      telemetry: Stagehand::Validation.telemetry_config({ traces: { endpoint: "https://o.example/v1/traces" } }),
      cache: { "threshold" => 2 },
      log_level: "info",
    })
    client.instance_variable_set(:@worker_init_metadata, Stagehand::WorkerInitMetadata.new(api_key: nil, browser: nil))
    cdp = Object.new
    def cdp.web_socket_debugger_url = "ws://127.0.0.1:9222/devtools/browser/x"
    client.instance_variable_set(:@cdp_client, cdp)

    values = client.send(:worker_init_values)
    params = Stagehand::Models::StagehandInitParams.new(**values)
    wire = params.to_wire
    assert_equal({ "traces" => { "endpoint" => "https://o.example/v1/traces" } }, wire["telemetry"])
    assert_equal({ "threshold" => 2 }, wire["cache"])
  end
end
