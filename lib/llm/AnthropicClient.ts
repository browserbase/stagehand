import Anthropic from '@anthropic-ai/sdk';
import { LLMClient, ChatCompletionOptions, ExtractionOptions } from "./LLMClient";
import { zodToJsonSchema } from "zod-to-json-schema";

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  public logger: (message: { category?: string; message: string }) => void;

  constructor(logger: (message: { category?: string; message: string }) => void) {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY, // Make sure to set this environment variable
    });
    this.logger = logger;
  }

  async createChatCompletion(options: ChatCompletionOptions) {
    const systemMessage = options.messages.find(msg => msg.role === 'system');
    const userMessages = options.messages.filter(msg => msg.role !== 'system');
    this.logger({ category: "Anthropic", 
      message: "Creating chat completion with options: " + JSON.stringify(options), 
      level: 2 
    });

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

    this.logger({ category: "Anthropic", 
      message: "Transformed response: " + JSON.stringify(transformedResponse), 
      level: 2 
    });

    return transformedResponse;
  }

  async createExtraction(options: ExtractionOptions) {
    this.logger({ category: "Anthropic", 
      message: "Creating extraction with options: " + JSON.stringify(options), 
      level: 2 
    });

    const jsonSchema = zodToJsonSchema(options.response_model.schema);
  
    // Extract the actual schema properties
    const schemaProperties = jsonSchema.definitions?.MySchema?.properties || jsonSchema.properties;
    const schemaRequired = jsonSchema.definitions?.MySchema?.required || jsonSchema.required;
  
    const toolDefinition = {
      name: "extract_data",
      description: "Extracts specific data from the given content based on the provided schema.",
      input_schema: {
        type: "object",
        properties: schemaProperties,
        required: schemaRequired
      }
    };

    const systemMessage = options.messages.find(msg => msg.role === 'system');
    const userMessages = options.messages.filter(msg => msg.role !== 'system');
    
    const response = await this.client.messages.create({
      model: options.model || 'claude-3-opus-20240229',
      max_tokens: options.max_tokens || 1000,
      messages: userMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      system: systemMessage?.content || "You are an AI assistant capable of extracting structured data from text.",
      temperature: options.temperature || 0.1,
      tools: [toolDefinition]
    });

    this.logger({ category: "Anthropic", 
      message: "Response from Anthropic: " + JSON.stringify(response), 
      level: 2 
    });

    const toolUse = response.content.find(c => c.type === 'tool_use');
    if (toolUse && 'input' in toolUse) {
      const extractedData = toolUse.input;
      this.logger({ category: "Anthropic", 
        message: "Extracted data: " + JSON.stringify(extractedData), 
        level: 2 
      });
      return extractedData;
    } else {
      throw new Error("Extraction failed: No tool use with input in response");
    }
  }
}