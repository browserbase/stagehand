import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod/v4";
import {
  AnthropicModelIdSchema,
  CerebrasModelIdSchema,
  createLLMGenerateResultSchema,
  GoogleModelIdSchema,
  GroqModelIdSchema,
  LLMGenerateParamsSchema,
  LLMMessageSchema,
  LLMGenerateResultSchema,
  ModelProviderSchema,
  OpenAIModelIdSchema,
} from "../../protocol/schemas.js";
import type {
  KnownModelConfig,
  LLMGenerateParams,
  LLMGenerateResult,
} from "../../protocol/types.js";

const AiSdkMessagesSchema = z.array(LLMMessageSchema).transform((messages): ModelMessage[] => {
  const toolNames = new Map<string, string>();
  const result: ModelMessage[] = [];

  for (const message of messages) {
    const blocks = Array.isArray(message.content) ? message.content : [message.content];
    const standardBlocks = blocks.filter(
      (block) => block.type === "text" || block.type === "image",
    );

    if (standardBlocks.length > 0) {
      if (message.role === "user") {
        result.push({
          role: "user",
          content: standardBlocks.map((block) => {
            if (block.type === "text") return { type: "text", text: block.text };
            return { type: "image", image: block.data, mediaType: block.mimeType };
          }),
        });
      } else {
        result.push({
          role: "assistant",
          content: standardBlocks.map((block) => {
            if (block.type === "text") return { type: "text", text: block.text };
            return { type: "file", data: block.data, mediaType: block.mimeType };
          }),
        });
      }
    }

    for (const block of blocks) {
      if (block.type === "tool_use") {
        toolNames.set(block.id, block.name);
        result.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
            },
          ],
        });
      }

      if (block.type === "tool_result") {
        const toolName = toolNames.get(block.toolUseId);
        if (!toolName) {
          throw new TypeError(`Unknown tool call ID: ${block.toolUseId}`);
        }

        result.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: block.toolUseId,
              toolName,
              output: block.structuredContent
                ? { type: "json", value: block.structuredContent }
                : {
                    type: "text",
                    value: block.content
                      .map((content) => (content.type === "text" ? content.text : content.data))
                      .join("\n"),
                  },
            },
          ],
        });
      }
    }
  }

  return result;
});

const AiSdkGenerationSchema = z
  .object({
    text: z.string(),
    output: z.json().optional(),
    finishReason: z.string().nullish(),
    toolCalls: z
      .array(
        z.object({
          toolCallId: z.string(),
          toolName: z.string(),
          input: z.record(z.string(), z.json()),
        }),
      )
      .default([]),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().nullish(),
        outputTokens: z.number().int().nonnegative().nullish(),
        totalTokens: z.number().int().nonnegative().nullish(),
        reasoningTokens: z.number().int().nonnegative().nullish(),
        cachedInputTokens: z.number().int().nonnegative().nullish(),
      })
      .strip(),
  })
  .strip();

/** Creates a direct AI SDK model from a validated Stagehand model configuration. */
export function createAiSdkLanguageModel(config: KnownModelConfig): LanguageModel {
  const separator = config.modelName.indexOf("/");
  const provider = ModelProviderSchema.parse(config.modelName.slice(0, separator));
  const modelId = config.modelName.slice(separator + 1);
  const connection = {
    apiKey: config.apiKey,
    headers: config.headers,
  };

  switch (provider) {
    case "openai":
      return createOpenAI(connection).responses(OpenAIModelIdSchema.parse(modelId));
    case "anthropic":
      return createAnthropic(connection)(AnthropicModelIdSchema.parse(modelId));
    case "google":
      return createGoogleGenerativeAI(connection)(GoogleModelIdSchema.parse(modelId));
    case "groq":
      return createGroq(connection)(GroqModelIdSchema.parse(modelId));
    case "cerebras":
      return createCerebras(connection)(CerebrasModelIdSchema.parse(modelId));
  }
}

/** Generates a Stagehand LLM response through a configured AI SDK language model. */
export async function generateWithAiSdk(
  model: LanguageModel,
  input: LLMGenerateParams,
): Promise<LLMGenerateResult> {
  const params = LLMGenerateParamsSchema.parse(input);
  // TODO: Forward params.tools and params.toolChoice when tool-driven inference is implemented.
  const response = await generateText({
    model,
    instructions: params.systemPrompt,
    messages: AiSdkMessagesSchema.parse(params.messages),
    temperature: params.temperature,
    stopSequences: params.stopSequences,
    ...(params.responseFormat?.type === "json_schema"
      ? {
          output: Output.object({
            name: params.responseFormat.name,
            description: params.responseFormat.description,
            schema: z.fromJSONSchema(
              params.responseFormat.schema as Parameters<typeof z.fromJSONSchema>[0],
            ),
          }),
        }
      : {}),
  });

  const result = AiSdkGenerationSchema.transform((value) => {
    const content = [
      { type: "text" as const, text: value.text },
      ...value.toolCalls.map((toolCall) => ({
        type: "tool_use" as const,
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        input: toolCall.input,
      })),
    ];
    const result = {
      role: "assistant" as const,
      content: content.length === 1 ? content[0]! : content,
      stopReason: value.finishReason ?? undefined,
      usage: {
        inputTokens: value.usage.inputTokens ?? 0,
        outputTokens: value.usage.outputTokens ?? 0,
        totalTokens: value.usage.totalTokens ?? 0,
        ...(value.usage.reasoningTokens === undefined
          ? {}
          : { reasoningTokens: value.usage.reasoningTokens }),
        ...(value.usage.cachedInputTokens === undefined
          ? {}
          : { cachedInputTokens: value.usage.cachedInputTokens }),
      },
    };

    return params.responseFormat?.type === "json_schema"
      ? {
          ...result,
          outputFormat: "json_schema" as const,
          structuredContent: value.output,
        }
      : {
          ...result,
          outputFormat: "text" as const,
        };
  }).parse(response);

  const candidate: unknown = result;
  const validatedResult: unknown = createLLMGenerateResultSchema(params).parse(candidate);
  return LLMGenerateResultSchema.parse(validatedResult);
}
