import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
    generateText: vi.fn(),
  };
});

const mockGenerateObject = vi.mocked(generateObject);
const mockGenerateText = vi.mocked(generateText);

function createModel(modelId: string) {
  return {
    modelId,
    specificationVersion: "v2",
  } as unknown as LanguageModelV2;
}

describe("AISdkClient structured output provider options", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateObject.mockResolvedValue({
      object: { ok: true },
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
    } as never);
  });

  it.each([
    ["openai/gpt-4.1", { openai: { strictJsonSchema: true } }],
    ["azure/gpt-4.1", { azure: { strictJsonSchema: true } }],
    ["google/gemini-2.5-pro", { google: { structuredOutputs: true } }],
    ["vertex/gemini-2.5-pro", { vertex: { structuredOutputs: true } }],
    ["groq/llama-3.3-70b-versatile", { groq: { structuredOutputs: true } }],
    ["cerebras/llama-4-scout", { cerebras: { strictJsonSchema: true } }],
    [
      "mistral/mistral-large-latest",
      { mistral: { structuredOutputs: true, strictJsonSchema: true } },
    ],
  ])(
    "passes provider structured-output options for %s",
    async (modelId, providerOptions) => {
      const client = new AISdkClient({
        model: createModel(modelId),
        logger: vi.fn(),
      });

      await client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "hello" }],
          response_model: {
            name: "test",
            schema: z.object({ ok: z.boolean() }),
          },
        },
        logger: vi.fn(),
      });

      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions,
        }),
      );
    },
  );

  it("omits temperature for claude-opus-4-7 structured calls", async () => {
    const client = new AISdkClient({
      model: createModel("anthropic/claude-opus-4-7"),
      logger: vi.fn(),
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
        response_model: {
          name: "test",
          schema: z.object({ ok: z.boolean() }),
        },
        temperature: 0.1,
      },
      logger: vi.fn(),
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: undefined,
      }),
    );
  });
});

describe("AISdkClient allowSystemInMessages", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateObject.mockResolvedValue({
      object: { ok: true },
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
    } as never);

    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({
      text: "done",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
    } as never);
  });

  const systemAndUserMessages = [
    { role: "system" as const, content: "you are a helpful assistant" },
    { role: "user" as const, content: "hello" },
  ];

  it("passes allowSystemInMessages: true on the generateObject (response_model) call", async () => {
    const client = new AISdkClient({
      model: createModel("anthropic/claude-haiku-4-5"),
      logger: vi.fn(),
    });

    await client.createChatCompletion({
      options: {
        messages: systemAndUserMessages,
        response_model: { name: "test", schema: z.object({ ok: z.boolean() }) },
      },
      logger: vi.fn(),
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ allowSystemInMessages: true }),
    );
  });

  it("passes allowSystemInMessages: true on the generateText (tool-calling) call", async () => {
    const client = new AISdkClient({
      model: createModel("anthropic/claude-haiku-4-5"),
      logger: vi.fn(),
    });

    await client.createChatCompletion({
      options: {
        messages: systemAndUserMessages,
      },
      logger: vi.fn(),
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ allowSystemInMessages: true }),
    );
  });
});
