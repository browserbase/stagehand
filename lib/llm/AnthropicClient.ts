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
    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.max_tokens || 1500,
      messages: userMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      system: systemMessage?.content,
      temperature: options.temperature,
    });

    // Parse the response here
    return {
      ...response,
      choices: [{
        message: {
          content: response.content[0].text,
          // Add other necessary fields here
        }
      }]
    };
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