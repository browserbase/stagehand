import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, ChatCompletionOptions, ExtractionOptions } from "./LLMClient";

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY, // Make sure to set this environment variable
    });
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    const systemMessage = options.messages.find(msg => msg.role === 'system');
    const userMessages = options.messages.filter(msg => msg.role !== 'system');

    console.log("createChatCompletion", options);
      // Transform tools to Anthropic's format
      const anthropicTools = options.tools?.map(tool => {
        if (tool.type === 'function') {
          return {
            name: tool.function.name,
            description: tool.function.description,
            input_schema: {
              type: "object",
              properties: tool.function.parameters.properties,
              required: tool.function.parameters.required,
            },
          };
        }
        return tool;
      });

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.max_tokens || 1500,
      messages: userMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      tools: anthropicTools,
      system: systemMessage?.content,
      temperature: options.temperature,
    });

    // Parse the response here
    console.log("response from anthropic", response);
    const transformedResponse = {
      id: response.id,
      object: 'chat.completion',
      created: Date.now(),
      model: response.model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: response.content.find(c => c.type === 'text')?.text || null,
          tool_calls: response.content
            .filter(c => c.type === 'tool_use')
            .map(toolUse => ({
              id: toolUse.id,
              type: 'function',
              function: {
                name: toolUse.name,
                arguments: JSON.stringify(toolUse.input)
              }
            }))
        },
        finish_reason: response.stop_reason
      }],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens
      }
    };
    console.log("transformedResponse", transformedResponse);
    return transformedResponse;
  }

  async createExtraction(options: ExtractionOptions) {
    const toolDefinition = {
      name: "extract_data",
      description: "Extracts specific data from the given content based on the provided schema.",
      input_schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The content to extract data from"
          },
          schema: {
            type: "object",
            description: "The schema defining the structure of the data to be extracted"
          }
        },
        required: ["content", "schema"]
      }
    };

    const response = await this.client.messages.create({
      model: options.model || 'claude-3-opus-20240229',
      max_tokens: options.max_tokens || 1000,
      messages: [
        { role: "system", content: "You are an AI assistant capable of extracting structured data from text." },
        { role: "user", content: `Please extract the following information:\n${JSON.stringify(options.response_model.schema)}\n\nFrom this content:\n${options.messages[options.messages.length - 1].content}` }
      ],
      temperature: options.temperature || 0.1,
      tools: [toolDefinition],
      tool_choice: { type: "tool", name: "extract_data" }
    });

    if (response.content[0].type === 'tool_call') {
      const extractedData = JSON.parse(response.content[0].text);
      return extractedData;
    } else {
      throw new Error("Extraction failed: No tool call in response");
    }
  }
}