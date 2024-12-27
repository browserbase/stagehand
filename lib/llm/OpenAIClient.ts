import OpenAI, { ClientOptions } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ChatCompletion as OpenAIChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat";
import zodToJsonSchema from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AvailableModel, LLMUsageEntry } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { validateZodSchema } from "../utils";
import { ChatCompletionOptions, ChatMessage, LLMClient } from "./LLMClient";
import { Stagehand } from "../index";

interface ExtendedChatCompletion extends OpenAIChatCompletion {
  _stagehandTokenUsage?: LLMUsageEntry;
  _request_id?: string;
}

export class OpenAIClient extends LLMClient {
  public type = "openai" as const;
  private client: OpenAI;
  private cache: LLMCache | undefined;
  public logger: (message: LogLine) => void;
  private enableCaching: boolean;
  public clientOptions: ClientOptions;
  private stagehand?: Stagehand;

  constructor(
    logger: (message: LogLine) => void,
    enableCaching = false,
    cache: LLMCache | undefined,
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
    stagehand?: Stagehand,
  ) {
    super(modelName);
    this.clientOptions = clientOptions;
    this.client = new OpenAI(clientOptions);
    this.logger = logger;
    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
    this.stagehand = stagehand;
  }

  async createChatCompletion<T = ExtendedChatCompletion>(
    optionsInitial: ChatCompletionOptions,
    retries: number = 3,
  ): Promise<T> {
    let options: Partial<ChatCompletionOptions> = optionsInitial;

    // O1 models do not support most of the options. So we override them.
    // For schema and tools, we add them as user messages.
    let isToolsOverridedForO1 = false;
    if (this.modelName === "o1-mini" || this.modelName === "o1-preview") {
      /* eslint-disable */
      // Remove unsupported options
      let {
        tool_choice,
        top_p,
        frequency_penalty,
        presence_penalty,
        temperature,
      } = options;
      ({
        tool_choice,
        top_p,
        frequency_penalty,
        presence_penalty,
        temperature,
        ...options
      } = options);
      /* eslint-enable */
      // Remove unsupported options
      options.messages = options.messages.map((message) => ({
        ...message,
        role: "user",
      }));
      if (options.tools && options.response_model) {
        throw new Error(
          "Cannot use both tool and response_model for o1 models",
        );
      }

      if (options.tools) {
        // Remove unsupported options
        let { tools } = options;
        ({ tools, ...options } = options);
        isToolsOverridedForO1 = true;
        options.messages.push({
          role: "user",
          content: `You have the following tools available to you:\n${JSON.stringify(
            tools,
          )}

          Respond with the following zod schema format to use a method: {
            "name": "<tool_name>",
            "arguments": <tool_args>
          }
          
          Do not include any other text or formattings like \`\`\` in your response. Just the JSON object.`,
        });
      }
    }
    if (
      options.temperature &&
      (this.modelName === "o1-mini" || this.modelName === "o1-preview")
    ) {
      throw new Error("Temperature is not supported for o1 models");
    }

    const { image, requestId, ...optionsWithoutImageAndRequestId } = options;

    this.logger({
      category: "openai",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify({
            ...optionsWithoutImageAndRequestId,
            requestId,
          }),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    const cacheOptions = {
      model: this.modelName,
      messages: options.messages,
      temperature: options.temperature,
      top_p: options.top_p,
      frequency_penalty: options.frequency_penalty,
      presence_penalty: options.presence_penalty,
      image: image,
      response_model: options.response_model,
    };

    if (this.enableCaching) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        options.requestId,
      );
      if (cachedResponse) {
        this.logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
          },
        });
        return cachedResponse;
      } else {
        this.logger({
          category: "llm_cache",
          message: "LLM cache miss - no cached response found",
          level: 1,
          auxiliary: {
            requestId: {
              value: options.requestId,
              type: "string",
            },
          },
        });
      }
    }

    if (options.image) {
      const screenshotMessage: ChatMessage = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${options.image.buffer.toString("base64")}`,
            },
          },
          ...(options.image.description
            ? [{ type: "text", text: options.image.description }]
            : []),
        ],
      };

      options.messages.push(screenshotMessage);
    }

    let responseFormat = undefined;
    if (options.response_model) {
      // For O1 models, we need to add the schema as a user message.
      if (this.modelName === "o1-mini" || this.modelName === "o1-preview") {
        try {
          const parsedSchema = JSON.stringify(
            zodToJsonSchema(options.response_model.schema),
          );
          options.messages.push({
            role: "user",
            content: `Respond in this zod schema format:\n${parsedSchema}\n

          Do not include any other text, formating or markdown in your output. Do not include \`\`\` or \`\`\`json in your response. Only the JSON object itself.`,
          });
        } catch (error) {
          this.logger({
            category: "openai",
            message: "Failed to parse response model schema",
            level: 0,
          });

          if (retries > 0) {
            // as-casting to account for o1 models not supporting all options
            return this.createChatCompletion(
              options as ChatCompletionOptions,
              retries - 1,
            );
          }

          throw error;
        }
      } else {
        responseFormat = zodResponseFormat(
          options.response_model.schema,
          options.response_model.name,
        );
      }
    }

    /* eslint-disable */
    // Remove unsupported options
    const { response_model, functionName, ...openAiOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };
    /* eslint-enable */

    this.logger({
      category: "openai",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        openAiOptions: {
          value: JSON.stringify(openAiOptions),
          type: "object",
        },
      },
    });

    const formattedMessages: ChatCompletionMessageParam[] =
      options.messages.map((message) => {
        if (Array.isArray(message.content)) {
          const contentParts = message.content.map((content) => {
            if ("image_url" in content) {
              const imageContent: ChatCompletionContentPartImage = {
                image_url: {
                  url: content.image_url.url,
                },
                type: "image_url",
              };
              return imageContent;
            } else {
              const textContent: ChatCompletionContentPartText = {
                text: content.text,
                type: "text",
              };
              return textContent;
            }
          });

          if (message.role === "system") {
            const formattedMessage: ChatCompletionSystemMessageParam = {
              ...message,
              role: "system",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          } else if (message.role === "user") {
            const formattedMessage: ChatCompletionUserMessageParam = {
              ...message,
              role: "user",
              content: contentParts,
            };
            return formattedMessage;
          } else {
            const formattedMessage: ChatCompletionAssistantMessageParam = {
              ...message,
              role: "assistant",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          }
        }

        const formattedMessage: ChatCompletionUserMessageParam = {
          role: "user",
          content: message.content,
        };

        return formattedMessage;
      });

    const body: ChatCompletionCreateParamsNonStreaming = {
      ...openAiOptions,
      model: this.modelName,
      messages: formattedMessages,
      response_format: responseFormat,
      stream: false,
      tools: options.tools?.filter((tool) => "function" in tool), // ensure only OpenAI tools are used
    };

    const response = await this.client.chat.completions.create(body);

    // Debug log the raw response with detailed token usage information
    this.logger({
      category: "openai",
      message: "raw response with usage data",
      level: 0, // Changed to level 0 to ensure visibility
      auxiliary: {
        usage: {
          value: JSON.stringify(response.usage),
          type: "object",
        },
        fullResponse: {
          value: JSON.stringify(response),
          type: "object",
        },
        tokenUsage: {
          value: JSON.stringify({
            prompt_tokens: response.usage?.prompt_tokens,
            completion_tokens: response.usage?.completion_tokens,
            total_tokens: response.usage?.total_tokens,
            model: this.modelName,
            functionName: optionsInitial.functionName,
          }),
          type: "object",
        },
      },
    });

    // Record token usage if stagehand is available
    if (response.usage && this.stagehand) {
      const prompt = response.usage.prompt_tokens ?? 0;
      const completion = response.usage.completion_tokens ?? 0;
      const total = response.usage.total_tokens ?? prompt + completion;
      this.stagehand.recordUsage(
        optionsInitial.functionName || "unknown",
        this.modelName,
        prompt,
        completion,
        total,
      );
    }

    // For O1 models, we need to parse the tool call response manually and add it to the response.
    if (isToolsOverridedForO1) {
      try {
        const parsedContent = JSON.parse(response.choices[0].message.content);

        response.choices[0].message.tool_calls = [
          {
            function: {
              name: parsedContent["name"],
              arguments: JSON.stringify(parsedContent["arguments"]),
            },
            type: "function",
            id: "-1",
          },
        ];
        response.choices[0].message.content = null;
      } catch (error) {
        this.logger({
          category: "openai",
          message: "Failed to parse tool call response",
          level: 0,
          auxiliary: {
            error: {
              value: error.message,
              type: "string",
            },
            content: {
              value: response.choices[0].message.content,
              type: "string",
            },
          },
        });

        if (retries > 0) {
          // as-casting to account for o1 models not supporting all options
          return this.createChatCompletion(
            options as ChatCompletionOptions,
            retries - 1,
          );
        }

        throw error;
      }
    }

    this.logger({
      category: "openai",
      message: "response",
      level: 1,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });

    if (options.response_model) {
      const extractedData = response.choices[0].message.content;
      const parsedData = JSON.parse(extractedData);

      if (!validateZodSchema(options.response_model.schema, parsedData)) {
        if (retries > 0) {
          // as-casting to account for o1 models not supporting all options
          return this.createChatCompletion(
            options as ChatCompletionOptions,
            retries - 1,
          );
        }

        throw new Error("Invalid response schema");
      }

      const responseWithTokenUsage = {
        ...parsedData,
        _stagehandTokenUsage: {
          functionName: optionsInitial.functionName || "unknown",
          modelName: this.modelName,
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
          timestamp: Date.now(),
        },
      };

      if (this.enableCaching) {
        this.cache.set(cacheOptions, responseWithTokenUsage, options.requestId);
      }

      return responseWithTokenUsage;
    }

    if (this.enableCaching) {
      this.logger({
        category: "llm_cache",
        message: "caching response",
        level: 1,
        auxiliary: {
          requestId: {
            value: options.requestId,
            type: "string",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });
      const responseToCache = {
        ...response,
        _stagehandTokenUsage: {
          functionName: optionsInitial.functionName || "unknown",
          modelName: this.modelName,
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
          timestamp: Date.now(),
        },
      };
      this.cache.set(cacheOptions, responseToCache, options.requestId);
    }

    // Add token usage to response
    const responseWithUsage = {
      ...response,
      _stagehandTokenUsage: {
        functionName: optionsInitial.functionName || "unknown",
        modelName: this.modelName,
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        timestamp: Date.now(),
      },
    };

    // if the function was called with a response model, it would have returned earlier
    // so we can safely cast here to T, which defaults to ExtendedChatCompletion
    return responseWithUsage as T;
  }
}
