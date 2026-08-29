# frozen_string_literal: true

# Bring-your-own-LLM: pass a callable as `model:` and Stagehand routes every
# model call back to it as an inbound llm.generate request (mirrors
# packages/sdk-python/examples/custom_llm.py). The callable receives decoded
# LLMStructuredGenerateParams / LLMMessageGenerateParams and must return a
# matching *GenerateResult.
#
# Provider: OPENAI_API_KEY (api.openai.com) or AI_GATEWAY_API_KEY (Vercel AI
# Gateway, OpenAI-compatible). Both use the chat completions JSON-schema
# response format.
#
#   ruby examples/custom_llm.rb                # local Chrome
#   ruby examples/custom_llm.rb --browserbase  # Browserbase session

require "json"
require "net/http"
require "uri"

require_relative "../lib/stagehand"
require_relative "example_helpers"

if ExampleHelpers.env("OPENAI_API_KEY")
  LLM_URL = URI("https://api.openai.com/v1/chat/completions")
  LLM_API_KEY = ExampleHelpers.env("OPENAI_API_KEY")
  LLM_MODEL = "gpt-5.4-mini"
elsif ExampleHelpers.env("AI_GATEWAY_API_KEY")
  LLM_URL = URI("https://ai-gateway.vercel.sh/v1/chat/completions")
  LLM_API_KEY = ExampleHelpers.env("AI_GATEWAY_API_KEY")
  LLM_MODEL = "openai/gpt-5.4-mini"
else
  abort "Set OPENAI_API_KEY or AI_GATEWAY_API_KEY."
end

GENERATION_NAMES = []

def message_text(content)
  blocks = content.is_a?(Array) ? content : [content]
  blocks.map do |block|
    unless block.is_a?(Stagehand::Models::LLMTextContent)
      kind = block.respond_to?(:type) ? block.type : block.class.name
      raise ArgumentError, "This example does not support #{kind} message blocks"
    end
    block.text
  end.join("\n")
end

# The llm.generate handler. Runs on the SDK's dispatcher thread.
def generate_with_openai(params)
  unless params.is_a?(Stagehand::Models::LLMStructuredGenerateParams)
    raise ArgumentError, "This example only supports structured generation"
  end

  response_format = params.response_format
  raise ArgumentError, "OpenAI structured output requires a JSON Schema" unless response_format.schema.is_a?(Hash)

  GENERATION_NAMES << response_format.name
  json_schema = { "name" => response_format.name, "schema" => response_format.schema, "strict" => true }
  json_schema["description"] = response_format.description unless response_format.description.nil?
  messages = []
  messages << { "role" => "system", "content" => params.system_prompt } unless params.system_prompt.nil?
  params.messages.each { |message| messages << { "role" => message.role, "content" => message_text(message.content) } }
  body = {
    "model" => LLM_MODEL,
    "messages" => messages,
    "response_format" => { "type" => "json_schema", "json_schema" => json_schema },
  }
  body["temperature"] = params.temperature unless params.temperature.nil?

  http_response = Net::HTTP.post(
    LLM_URL,
    JSON.generate(body),
    "Authorization" => "Bearer #{LLM_API_KEY}",
    "Content-Type" => "application/json",
  )
  raise "LLM request failed: #{http_response.code} #{http_response.body[0, 300]}" unless http_response.code == "200"

  payload = JSON.parse(http_response.body)
  choice = payload.fetch("choices").first
  output_text = choice.dig("message", "content")
  raise "LLM returned no output text" if output_text.nil? || output_text.empty?

  usage = payload["usage"]
  values = {
    role: "assistant",
    content: Stagehand::Models::LLMTextContent.new(type: "text", text: output_text),
    output_format: "json_schema",
    structured_content: JSON.parse(output_text),
  }
  values[:stop_reason] = choice["finish_reason"] unless choice["finish_reason"].nil?
  unless usage.nil?
    usage_values = {
      input_tokens: usage["prompt_tokens"],
      output_tokens: usage["completion_tokens"],
      total_tokens: usage["total_tokens"],
    }
    reasoning = usage.dig("completion_tokens_details", "reasoning_tokens")
    cached = usage.dig("prompt_tokens_details", "cached_tokens")
    usage_values[:reasoning_tokens] = reasoning unless reasoning.nil?
    usage_values[:cached_input_tokens] = cached unless cached.nil?
    values[:usage] = Stagehand::Models::LLMUsage.new(**usage_values)
  end
  Stagehand::Models::LLMStructuredGenerateResult.new(**values)
end

PAGE_INFO_SCHEMA = {
  "type" => "object",
  "properties" => {
    "heading" => { "type" => "string" },
    "description" => { "type" => "string" },
  },
  "required" => %w[heading description],
  "additionalProperties" => false,
}.freeze

browser =
  if ARGV.include?("--browserbase")
    api_key = ExampleHelpers.env("BROWSERBASE_API_KEY") or abort "Set BROWSERBASE_API_KEY."
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: api_key)
  else
    puts "Launching local Chrome..."
    Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
  end

begin
  stagehand = Stagehand.create(
    browser: browser,
    model: method(:generate_with_openai),
    log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn"),
  )
  begin
    page = browser.context.pages.first
    raise "Stagehand initialized without an active page" if page.nil?
    page.goto("https://example.com")

    extract_result = stagehand.extract("Extract the page heading and description", schema: PAGE_INFO_SCHEMA)
    observe_result = stagehand.observe("Find the link that provides more information about Example Domain")
    act_result = stagehand.act("Click the link that provides more information about Example Domain")

    puts JSON.pretty_generate({
      "page_info" => extract_result.data,
      "actions" => observe_result.data.map(&:to_wire),
      "action_result" => act_result.data.to_wire,
      "generation_names" => GENERATION_NAMES,
    })

    raise "observe() returned no matching actions" if observe_result.data.empty?
    raise "act() failed: #{act_result.data.message}" unless act_result.data.success
  ensure
    stagehand.close
  end
ensure
  browser.close
end
puts "Closed."
