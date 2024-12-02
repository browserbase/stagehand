import  { GenerativeModel, GenerationConfig, Content, GoogleGenerativeAI } from "@google/generative-ai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { ChatCompletionOptions, LLMClient } from "./LLMClient";

export class GoogleClient extends LLMClient {
  private client: GoogleGenerativeAI;
  private model: GenerativeModel;
  private cache: LLMCache | undefined;
  public logger: (message: LogLine) => void;
  private enableCaching: boolean;

  constructor(
    apiKey: string,
    logger: (message: LogLine) => void,
    enableCaching = false,
    cache: LLMCache | undefined,
    modelName: AvailableModel
  ) {
    super(modelName);
    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({ model: modelName });
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
  }

  async createChatCompletion(
    options: ChatCompletionOptions & { retries?: number }
  ): Promise<any> {
    // Remove image from options for logging
    const { image: _, ...optionsWithoutImage } = options;
    this.logger({
      category: "google",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify(optionsWithoutImage),
          type: "object",
        },
      },
    });

    // Prepare cache options
    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      image: options.image,
      response_model: options.response_model,
      tools: options.tools,
      retries: options.retries,
    };

    // Check cache
    if (this.enableCaching) {
      const cachedResponse = await this.cache.get(
        cacheOptions,
        options.requestId
      );
      if (cachedResponse) {
        this.logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
          },
        });
        return cachedResponse;
      }
    }

    // Prepare messages
    const systemMessage = options.messages.find((msg) => msg.role === "system");
    const userMessages = options.messages.filter((msg) => msg.role !== "system");

    // Prepare content for Google AI
    const contents: Content[] = userMessages.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    }));

    // Handle image if present
    if (options.image) {
      const imageMessage: Content = {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: options.image.buffer.toString("base64")
            }
          },
          ...(options.image.description 
            ? [{ text: options.image.description }] 
            : [])
        ]
      };
      contents.push(imageMessage);
    }

    // Prepare generation config
    const generationConfig: GenerationConfig = {
      temperature: options.temperature || 0.7,
      maxOutputTokens: options.maxTokens || 3000
    };

    // Prepare tools/function calling
    let tools: any[] = [];

    // Transform tools to Google's format if needed
    if (options.tools) {
      tools = options.tools.map((tool: any) => {
        if (tool.type === "function") {
          return {
            functionDeclarations: [{
              name: tool.function.name,
              description: tool.function.description,
              parameters: {
                type: "OBJECT",
                properties: tool.function.parameters.properties,
                required: tool.function.parameters.required
              }
            }]
          };
        }
        return tool;
      });
    }

    // Add response model as a tool if present
    if (options.response_model) {
      const jsonSchema = zodToJsonSchema(options.response_model.schema);
      const schemaProperties = 
        (jsonSchema.definitions?.MySchema as { properties?: Record<string, any> })?.properties ||
        (jsonSchema as { properties?: Record<string, any> }).properties;
      const schemaRequired = 
        (jsonSchema.definitions?.MySchema as { required?: string[] })?.required ||
        (jsonSchema as { required?: string[] }).required;

      const responseModelTool = {
        functionDeclarations: [{
          name: "print_extracted_data",
          description: "Prints the extracted data based on the provided schema.",
          parameters: {
            type: "OBJECT",
            properties: schemaProperties,
            required: schemaRequired
          }
        }]
      };

      tools.push(responseModelTool);
    }

    try {
      // Create chat completion
      const response = await this.model.generateContent({
        contents,
        generationConfig,
        tools
      });

      // Log response
      this.logger({
        category: "google",
        message: "response received",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });

      // Transform response to match Anthropic-like structure
      const transformedResponse = {
        id: Date.now().toString(), // Google doesn't provide a specific ID
        object: "chat.completion",
        created: Date.now(),
        model: this.modelName,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response.response.text() || null,
              tool_calls: response.response.functionCalls()?.map((call: any) => ({
                id: call.name,
                type: "function",
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.args)
                }
              })) || [],
            },
            finish_reason: "stop" // Google doesn't always provide specific finish reasons
          }
        ],
        usage: {
          // Google doesn't provide exact token counts in the same way
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };

      // Handle response model extraction
      if (options.response_model) {
        const functionCall = response.response.functionCalls()?.[0];
        if (functionCall) {
          if (this.enableCaching) {
            this.cache.set(cacheOptions, functionCall.args, options.requestId);
          }
          return functionCall.args;
        } else {
          // Retry mechanism
          if (!options.retries || options.retries < 5) {
            return this.createChatCompletion({
              ...options,
              retries: (options.retries ?? 0) + 1,
            });
          }
          throw new Error("Create Chat Completion Failed: No function call in response");
        }
      }

      // Cache the response if caching is enabled
      if (this.enableCaching) {
        this.cache.set(cacheOptions, transformedResponse, options.requestId);
      }

      return transformedResponse;

    } catch (error) {
      this.logger({
        category: "google",
        message: "error creating chat completion",
        level: 1,
        auxiliary: {
          error: {
            value: JSON.stringify(error),
            type: "object",
          },
          requestId: {
            value: options.requestId,
            type: "string",
          },
        },
      });
      throw error;
    }
  }
}