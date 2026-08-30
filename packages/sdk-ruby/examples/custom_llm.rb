# frozen_string_literal: true

# Bring-your-own-LLM: pass a callable as `model:` and Stagehand routes every
# model call back to it as an inbound llm.generate request (mirrors
# packages/sdk-python/examples/custom_llm.py). The callable receives decoded
# LLMStructuredGenerateParams / LLMMessageGenerateParams and must return a
# matching *GenerateResult.
#
# Provider: OPENAI_API_KEY (api.openai.com) or AI_GATEWAY_API_KEY (Vercel AI
# Gateway, OpenAI-compatible). Both use the OpenAI Responses API with the
# JSON-schema text format, like the TS and Python custom-LLM examples.
#
#   ruby examples/custom_llm.rb                # local Chrome
#   ruby examples/custom_llm.rb --browserbase  # Browserbase session

require "json"
require "net/http"
require "uri"

require_relative "../lib/stagehand"

if !ENV.fetch("OPENAI_API_KEY", "").empty?
  LLM_URL = URI("https://api.openai.com/v1/responses")
  LLM_API_KEY = ENV.fetch("OPENAI_API_KEY")
  LLM_MODEL = "gpt-5.4-mini"
elsif !ENV.fetch("AI_GATEWAY_API_KEY", "").empty?
  LLM_URL = URI("https://ai-gateway.vercel.sh/v1/responses")
  LLM_API_KEY = ENV.fetch("AI_GATEWAY_API_KEY")
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

# The llm.generate handler. Each request runs on its own SDK thread, so
# concurrent generations are possible.
def generate_with_openai(params)
  unless params.is_a?(Stagehand::Models::LLMStructuredGenerateParams)
    raise ArgumentError, "This example only supports structured generation"
  end

  response_format = params.response_format
  raise ArgumentError, "OpenAI structured output requires a JSON Schema" unless response_format.schema.is_a?(Hash)

  GENERATION_NAMES << response_format.name
  text_format = {
    "type" => "json_schema",
    "name" => response_format.name,
    "schema" => response_format.schema,
    "strict" => true,
  }
  text_format["description"] = response_format.description unless response_format.description.nil?
  body = {
    "model" => LLM_MODEL,
    "input" => params.messages.map { |message| { "role" => message.role, "content" => message_text(message.content) } },
    "text" => { "format" => text_format },
  }
  body["instructions"] = params.system_prompt unless params.system_prompt.nil?
  body["temperature"] = params.temperature unless params.temperature.nil?

  http_response = Net::HTTP.post(
    LLM_URL,
    JSON.generate(body),
    "Authorization" => "Bearer #{LLM_API_KEY}",
    "Content-Type" => "application/json",
  )
  raise "LLM request failed: #{http_response.code} #{http_response.body[0, 300]}" unless http_response.code == "200"

  payload = JSON.parse(http_response.body)
  output_text = payload.fetch("output", [])
                       .select { |item| item["type"] == "message" }
                       .flat_map { |item| item.fetch("content", []) }
                       .select { |block| block["type"] == "output_text" }
                       .map { |block| block["text"] }
                       .join
  raise "LLM returned no output text" if output_text.empty?

  usage = payload["usage"]
  values = {
    role: "assistant",
    content: Stagehand::Models::LLMTextContent.new(type: "text", text: output_text),
    output_format: "json_schema",
    structured_content: JSON.parse(output_text),
  }
  values[:stop_reason] = payload["status"] unless payload["status"].nil?
  unless usage.nil?
    usage_values = {
      input_tokens: usage["input_tokens"],
      output_tokens: usage["output_tokens"],
      total_tokens: usage["total_tokens"],
    }
    reasoning = usage.dig("output_tokens_details", "reasoning_tokens")
    cached = usage.dig("input_tokens_details", "cached_tokens")
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
    puts "Creating a Browserbase session..."
    Stagehand::Browserbase.launch(api_key: ENV.fetch("BROWSERBASE_API_KEY"))
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
