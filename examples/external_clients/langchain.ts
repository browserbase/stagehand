import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { CreateChatCompletionOptions, LLMClient, AvailableModel } from "@/dist";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AIMessage,
  BaseMessageLike,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatCompletion } from "openai/resources";
import {
  CreateChatCompletionResponseError,
  GenerateObjectOptions,
  GenerateTextOptions,
  LLMObjectResponse,
  LLMResponse,
  ObjectResponse,
  TextResponse,
} from "@/lib";

export class LangchainClient extends LLMClient {
  public type = "langchainClient" as const;
  private model: BaseChatModel;

  constructor(model: BaseChatModel) {
    super(model.name as AvailableModel);
    this.model = model;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    const formattedMessages: BaseMessageLike[] = options.messages.map(
      (message) => {
        if (Array.isArray(message.content)) {
          if (message.role === "system") {
            return new SystemMessage(
              message.content
                .map((c) => ("text" in c ? c.text : ""))
                .join("\n"),
            );
          }

          const content = message.content.map((content) =>
            "image_url" in content
              ? { type: "image", image: content.image_url.url }
              : { type: "text", text: content.text },
          );

          if (message.role === "user") return new HumanMessage({ content });

          const textOnlyParts = content.map((part) => ({
            type: "text" as const,
            text: part.type === "image" ? "[Image]" : part.text,
          }));

          return new AIMessage({ content: textOnlyParts });
        }

        return {
          role: message.role,
          content: message.content,
        };
      },
    );

    if (options.response_model) {
      const responseSchema = zodToJsonSchema(options.response_model.schema, {
        $refStrategy: "none",
      });
      const structuredModel = this.model.withStructuredOutput(responseSchema);
      const response = await structuredModel.invoke(formattedMessages);

      return {
        data: response,
        usage: {
          prompt_tokens: 0, // Langchain doesn't provide token counts by default
          completion_tokens: 0,
          total_tokens: 0,
        },
      } as T;
    }

    const modelWithTools = this.model.bindTools(options.tools);
    const response = await modelWithTools.invoke(formattedMessages);

    return {
      data: response,
      usage: {
        prompt_tokens: 0, // Langchain doesn't provide token counts by default
        completion_tokens: 0,
        total_tokens: 0,
      },
    } as T;
  }

  async generateText<T = TextResponse>({
    prompt,
    options = {},
  }: GenerateTextOptions): Promise<T> {
    // Destructure options with defaults
    const { logger = () => {}, retries = 3, ...chatOptions } = options;

    // Create chat completion with single user message
    const res = await (this.createChatCompletion({
      options: {
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        ...chatOptions,
        // Generate unique request ID if not provided
        requestId: options.requestId || Date.now().toString(),
      },
      logger,
      retries,
    }) as Promise<LLMResponse>);

    // Validate and extract response
    if (res.choices && res.choices.length > 0) {
      return {
        ...res,
        text: res.choices[0].message.content,
      } as T;
    } else {
      throw new CreateChatCompletionResponseError("No choices in response");
    }
  }
  async generateObject<T = ObjectResponse>({
    prompt,
    schema,
    options = {},
  }: GenerateObjectOptions): Promise<T> {
    // Destructure options with defaults
    const {
      logger = () => {},
      retries = 3,
      requestId = Date.now().toString(),
      ...chatOptions
    } = options;

    try {
      // Log the generation attempt
      logger({
        category: "anthropic",
        message: "Initiating object generation",
        level: 2,
        auxiliary: {
          prompt: {
            value: prompt,
            type: "string",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      // Create chat completion with the provided prompt
      const response = (await this.createChatCompletion({
        options: {
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          response_model: {
            name: "object",
            schema: schema,
          },
          ...chatOptions,
          requestId,
        },
        logger,
        retries,
      })) as LLMObjectResponse;

      // Validate response structure
      if (!response.data || response.data.length === 0) {
        throw new CreateChatCompletionResponseError(
          "API response contains no valid choices",
        );
      }

      // Extract and validate the generated text
      const generatedObject = response.data;
      if (generatedObject === null || generatedObject === undefined) {
        throw new CreateChatCompletionResponseError(
          "Generated text content is empty",
        );
      }

      // Construct the final response
      const objResponse = {
        ...response,
        object: generatedObject,
      } as T;

      // Log successful generation
      logger({
        category: "anthropic",
        message: "Text generation successful",
        level: 2,
        auxiliary: {
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      return objResponse;
    } catch (error) {
      // Log the error
      logger({
        category: "anthropic",
        message: "Object generation failed",
        level: 0,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
          prompt: {
            value: prompt,
            type: "string",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      // Re-throw the error to be handled by the caller
      throw error;
    }
  }
}
