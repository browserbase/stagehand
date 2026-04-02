import { generateText, Output, type Tool } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { CreateChatCompletionOptions, LLMClient } from "../llm/LLMClient.js";
import { AvailableModel } from "../types/public/index.js";
import { ChatCompletion } from "openai/resources";
import { formatAiSdkMessages, toLLMUsage } from "../llm/aiSdkCompat.js";

export class AISdkClient extends LLMClient {
  public type = "aisdk" as const;
  private model: LanguageModelV3;

  constructor({ model }: { model: LanguageModelV3 }) {
    super(model.modelId as AvailableModel);
    this.model = model;
  }

  async createChatCompletion<T = ChatCompletion>({
    options,
  }: CreateChatCompletionOptions): Promise<T> {
    const formattedMessages = formatAiSdkMessages(options.messages);

    if (options.response_model) {
      const response = await generateText({
        model: this.model,
        messages: formattedMessages,
        output: Output.object({
          schema: options.response_model.schema,
          name: options.response_model.name,
        }),
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        topP: options.top_p,
        frequencyPenalty: options.frequency_penalty,
        presencePenalty: options.presence_penalty,
        providerOptions:
          options.response_model.strict === false
            ? { openai: { strictJsonSchema: false } }
            : undefined,
      });

      return {
        data: response.output,
        usage: toLLMUsage(response.usage),
      } as T;
    }

    const tools: Record<string, Tool> = {};
    for (const rawTool of options.tools ?? []) {
      tools[rawTool.name] = {
        description: rawTool.description,
        inputSchema: rawTool.parameters,
      } as Tool;
    }

    const response = await generateText({
      model: this.model,
      messages: formattedMessages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      toolChoice:
        Object.keys(tools).length > 0
          ? options.tool_choice === "required"
            ? "required"
            : options.tool_choice === "none"
              ? "none"
              : "auto"
          : undefined,
      maxOutputTokens: options.maxOutputTokens,
      temperature: options.temperature,
      topP: options.top_p,
      frequencyPenalty: options.frequency_penalty,
      presencePenalty: options.presence_penalty,
    });

    return {
      data: response.text,
      usage: toLLMUsage(response.usage),
    } as T;
  }
}
