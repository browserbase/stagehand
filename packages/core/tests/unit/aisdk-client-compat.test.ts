import { describe, expect, it, vi } from "vitest";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";

type ScriptedGenerateResult = {
  content: LanguageModelV3Content[];
  finishReason?: LanguageModelV3FinishReason;
  usage?: Partial<LanguageModelV3Usage>;
};

const DEFAULT_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 1,
    text: 1,
    reasoning: 0,
  },
};

function createScriptedModel(
  generate: (
    options: LanguageModelV3CallOptions,
  ) => ScriptedGenerateResult | Promise<ScriptedGenerateResult>,
  modelId = "mock/stagehand-compat",
): LanguageModelV3 {
  return {
    provider: "mock",
    modelId,
    specificationVersion: "v3",
    supportedUrls: {},
    doGenerate: vi.fn(async (callOptions) => {
      const result = await generate(callOptions);
      return {
        content: result.content,
        finishReason: result.finishReason ?? { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: {
            ...DEFAULT_USAGE.inputTokens,
            ...(result.usage?.inputTokens ?? {}),
          },
          outputTokens: {
            ...DEFAULT_USAGE.outputTokens,
            ...(result.usage?.outputTokens ?? {}),
          },
          ...(result.usage?.raw ? { raw: result.usage.raw } : {}),
        },
        warnings: [],
      } satisfies LanguageModelV3GenerateResult;
    }),
    doStream: async () => {
      throw new Error("Streaming is not implemented for this test model.");
    },
  };
}

describe("AISdkClient compatibility", () => {
  it("createChatCompletion() with response_model returns legacy parsed response shape", async () => {
    const model = createScriptedModel(() => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ title: "Compatibility Title" }),
        },
      ],
      usage: {
        inputTokens: {
          total: 17,
          noCache: 14,
          cacheRead: 3,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 9,
          text: 5,
          reasoning: 4,
        },
      },
    }));

    const client = new AISdkClient({ model });

    const result = await client.createChatCompletion({
      options: {
        messages: [
          { role: "system", content: "You are a helpful extractor." },
          { role: "user", content: "Extract the page title." },
        ],
        response_model: {
          name: "Extraction",
          schema: z.object({ title: z.string() }),
        },
      },
      logger: vi.fn(),
    });

    expect(result).toEqual({
      data: { title: "Compatibility Title" },
      usage: {
        prompt_tokens: 17,
        completion_tokens: 9,
        reasoning_tokens: 4,
        cached_input_tokens: 3,
        total_tokens: 26,
      },
    });
  });

  it("createChatCompletion() with response_model preserves legacy usage fields", async () => {
    const model = createScriptedModel(() => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({ status: "ok" }),
        },
      ],
      usage: {
        inputTokens: {
          total: 13,
          noCache: 11,
          cacheRead: 2,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 7,
          text: 2,
          reasoning: 5,
        },
      },
    }));

    const client = new AISdkClient({ model });

    const result = await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "Return the extraction status." }],
        response_model: {
          name: "Extraction",
          schema: z.object({ status: z.string() }),
        },
      },
      logger: vi.fn(),
    });

    expect(result.usage).toEqual({
      prompt_tokens: 13,
      completion_tokens: 7,
      reasoning_tokens: 5,
      cached_input_tokens: 2,
      total_tokens: 20,
    });
    expect(result.usage).not.toHaveProperty("inputTokens");
    expect(result.usage).not.toHaveProperty("outputTokens");
    expect(result.usage).not.toHaveProperty("reasoningTokens");
    expect(result.usage).not.toHaveProperty("cachedInputTokens");
  });

  it("createChatCompletion() with response_model throws NoObjectGeneratedError for invalid structured output", async () => {
    const model = createScriptedModel(() => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            invalidResponseShape: "missing required title field",
          }),
        },
      ],
    }));

    const client = new AISdkClient({ model });

    await expect(
      client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "Return the extraction title." }],
          response_model: {
            name: "Extraction",
            schema: z.object({ title: z.string() }),
          },
        },
        logger: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(NoObjectGeneratedError);
  });

  it("createChatCompletion() without response_model maps tool calls into legacy chat completion shape", async () => {
    const model = createScriptedModel(() => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "click-1",
          toolName: "click",
          input: JSON.stringify({ elementId: "1-0" }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: {
        inputTokens: {
          total: 11,
          noCache: 11,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: {
          total: 6,
          text: 6,
          reasoning: 0,
        },
      },
    }));

    const client = new AISdkClient({ model });

    const result = await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "Click the highlighted button." }],
        tools: [
          {
            type: "function",
            name: "click",
            description: "Click an element on the page.",
            parameters: z.object({
              elementId: z.string(),
            }) as unknown as Record<string, unknown>,
          },
        ],
        tool_choice: "required",
      },
      logger: vi.fn(),
    });

    expect(result.choices[0]).toEqual({
      index: 0,
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "click-1",
            type: "function",
            function: {
              name: "click",
              arguments: JSON.stringify({ elementId: "1-0" }),
            },
          },
        ],
      },
      finish_reason: "tool-calls",
    });
    expect(result.usage).toEqual({
      prompt_tokens: 11,
      completion_tokens: 6,
      reasoning_tokens: 0,
      cached_input_tokens: 0,
      total_tokens: 17,
    });
  });
});
