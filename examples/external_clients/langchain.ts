import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  CreateChatCompletionOptions,
  LLMClient,
  AvailableModel,
} from "@browserbasehq/stagehand";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AIMessage,
  BaseMessageLike,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatCompletion } from "openai/resources";

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
}
