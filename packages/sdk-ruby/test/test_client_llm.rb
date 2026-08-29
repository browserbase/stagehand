# frozen_string_literal: true

require_relative "test_helper"
require_relative "support/fake_transport"

# Client-side LLM (bring-your-own-model): a callable `model:` registers an
# llm.generate handler and announces itself to the worker as
# ClientModelReference(source: "client").
class TestClientLLM < Minitest::Test
  def build_client(model:)
    transport = FakeTransport.new
    def transport.web_socket_debugger_url = "ws://127.0.0.1:9222/devtools/browser/fake"
    browser = Object.new
    def browser.__attach_context(context) = @context = context

    client = Stagehand::Client.allocate
    client.instance_variable_set(:@browser, browser)
    client.instance_variable_set(:@cdp_client, transport)
    client.instance_variable_set(:@worker_init_metadata, Stagehand::WorkerInitMetadata.new(api_key: nil, browser: nil))
    client.instance_variable_set(:@config, { model: model, log_level: "warn" })
    client.instance_variable_set(:@rpc_client, nil)
    client.instance_variable_set(:@remove_log_listener, nil)
    client.instance_variable_set(:@remove_client_llm_handler, nil)
    client.instance_variable_set(:@initialized, false)
    [client, transport]
  end

  def test_worker_init_announces_client_model_and_serves_llm_generate
    calls = []
    model = lambda do |params|
      calls << params
      Stagehand::Models::LLMStructuredGenerateResult.new(
        role: "assistant",
        content: Stagehand::Models::LLMTextContent.new(type: "text", text: "{}"),
        output_format: "json_schema",
        structured_content: { "heading" => "Example Domain" },
      )
    end
    client, transport = build_client(model: model)

    responder = Thread.new do
      request = transport.next_sent
      transport.push({ "jsonrpc" => "2.0", "id" => request["id"],
                       "result" => { "initialized" => true, "pages" => [] } })
      request
    end
    client.__initialize_runtime
    init_request = responder.value
    assert_equal "stagehand.init", init_request["method"]
    assert_equal({ "source" => "client" }, init_request["params"]["model"])

    transport.push({
      "jsonrpc" => "2.0", "id" => 3, "method" => "llm.generate",
      "params" => {
        "messages" => [{ "role" => "user", "content" => { "type" => "text", "text" => "extract" } }],
        "response_format" => { "type" => "json_schema", "name" => "page_info", "schema" => { "type" => "object" } },
      },
    })
    reply = transport.next_sent
    assert_equal 3, reply["id"]
    assert_equal "Example Domain", reply.dig("result", "structured_content", "heading")
    assert_equal 1, calls.size
    assert_instance_of Stagehand::Models::LLMStructuredGenerateParams, calls.first

    # Close the transport first so the RPC reader unblocks without the kill
    # backstop's 2s join; then release exactly like Client#close does.
    transport.close
    client.__release_resources
    assert_nil client.instance_variable_get(:@remove_client_llm_handler)
  end

  def test_string_model_still_sends_model_config
    client, transport = build_client(model: nil)
    client.instance_variable_set(:@config, { model: "openai/gpt-5-mini", model_api_key: "sk-test", log_level: "warn" })
    values = client.send(:worker_init_values)
    assert_instance_of Stagehand::Models::ModelConfig, values[:model]
    assert_equal "openai/gpt-5-mini", values[:model].model_name
    transport.close
  end

  def test_create_rejects_connection_options_with_callback
    browser = Stagehand::StagehandBrowser.allocate
    error = assert_raises(ArgumentError) do
      Stagehand::Client.create(browser: browser, model: ->(params) { params }, model_api_key: "sk-test")
    end
    assert_equal "model connection options cannot be used with an LLM callback", error.message
  end

  def test_create_rejects_non_string_non_callable_model
    browser = Stagehand::StagehandBrowser.allocate
    error = assert_raises(ArgumentError) do
      Stagehand::Client.create(browser: browser, model: 42)
    end
    assert_match(/model name String or a callable/, error.message)
  end
end
