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

function createClient(
  modelId: string,
  clientOptions?: { temperature?: number },
  logger: (message: unknown) => void = vi.fn(),
) {
  return {
    client: new AISdkClient({
      model: createModel(modelId),
      logger: logger as never,
      clientOptions,
    }),
    logger,
  };
}

describe("AISdkClient", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
    mockGenerateText.mockReset();

    mockGenerateObject.mockResolvedValue({
      object: { ok: true },
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
      warnings: undefined,
    } as never);

    mockGenerateText.mockResolvedValue({
      text: "ok",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
      warnings: undefined,
    } as never);
  });

  it.each([
    ["openai/gpt-4.1", { openai: { strictJsonSchema: true } }],
    ["azure/gpt-4.1", { azure: { strictJsonSchema: true } }],
    ["google/gemini-2.5-pro", { google: { structuredOutputs: true } }],
    ["vertex/gemini-2.5-pro", { vertex: { structuredOutputs: true } }],
    [
      "anthropic/claude-sonnet-4-20250514",
      { anthropic: { structuredOutputMode: "auto" } },
    ],
    ["groq/llama-3.3-70b-versatile", { groq: { structuredOutputs: true } }],
    ["cerebras/llama-4-scout", { cerebras: { strictJsonSchema: true } }],
    [
      "mistral/mistral-large-latest",
      { mistral: { structuredOutputs: true, strictJsonSchema: true } },
    ],
  ])(
    "passes provider structured-output options for %s",
    async (modelId, providerOptions) => {
      const { client } = createClient(modelId);

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

  it.each([
    [
      "non-Kimi generateObject uses per-call temperature",
      "openai/gpt-4.1",
      undefined,
      0.1,
      0.1,
    ],
    [
      "non-Kimi generateObject falls back to client temperature",
      "openai/gpt-4.1",
      0.4,
      undefined,
      0.4,
    ],
    [
      "non-Kimi generateObject prefers per-call over client temperature",
      "openai/gpt-4.1",
      0.4,
      0.1,
      0.1,
    ],
    [
      "Kimi generateObject forces temperature to 1 over per-call input",
      "moonshotai/kimi-k2-instruct",
      undefined,
      0.1,
      1,
    ],
    [
      "Kimi generateObject forces temperature to 1 over client input",
      "moonshotai/kimi-k2-instruct",
      0.4,
      undefined,
      1,
    ],
  ])(
    "%s",
    async (
      _testName,
      modelId,
      clientTemperature,
      callTemperature,
      expectedTemperature,
    ) => {
      const { client } = createClient(modelId, {
        temperature: clientTemperature,
      });

      await client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "hello" }],
          response_model: {
            name: "test",
            schema: z.object({ ok: z.boolean() }),
          },
          temperature: callTemperature,
        },
        logger: vi.fn(),
      });

      expect(mockGenerateObject).toHaveBeenLastCalledWith(
        expect.objectContaining({
          temperature: expectedTemperature,
        }),
      );
    },
  );

  it.each([
    [
      "non-Kimi generateText uses per-call temperature",
      "openai/gpt-4.1",
      undefined,
      0.1,
      0.1,
    ],
    [
      "non-Kimi generateText falls back to client temperature",
      "openai/gpt-4.1",
      0.4,
      undefined,
      0.4,
    ],
    [
      "non-Kimi generateText prefers per-call over client temperature",
      "openai/gpt-4.1",
      0.4,
      0.1,
      0.1,
    ],
    [
      "Kimi generateText forces temperature to 1",
      "moonshotai/kimi-k2-instruct",
      0.4,
      0.1,
      1,
    ],
  ])(
    "%s",
    async (
      _testName,
      modelId,
      clientTemperature,
      callTemperature,
      expectedTemperature,
    ) => {
      const { client } = createClient(modelId, {
        temperature: clientTemperature,
      });

      await client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "hello" }],
          temperature: callTemperature,
        },
        logger: vi.fn(),
      });

      expect(mockGenerateText).toHaveBeenLastCalledWith(
        expect.objectContaining({
          temperature: expectedTemperature,
        }),
      );
    },
  );

  it("logs provider warnings from generateObject", async () => {
    const { client, logger } = createClient("anthropic/claude-opus-4-7");
    const warnings = [
      {
        type: "unsupported-setting",
        setting: "temperature",
        details: "temperature is not supported by anthropic/claude-opus-4-7.",
      },
    ];

    mockGenerateObject.mockResolvedValueOnce({
      object: { ok: true },
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 3,
      },
      warnings,
    } as never);

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
        response_model: {
          name: "test",
          schema: z.object({ ok: z.boolean() }),
        },
        temperature: 0.1,
        requestId: "req_123",
      },
      logger: logger as never,
    });

    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "aisdk",
        message: "provider warnings",
        auxiliary: expect.objectContaining({
          warnings: {
            value: JSON.stringify(warnings),
            type: "object",
          },
          requestId: {
            value: "req_123",
            type: "string",
          },
        }),
      }),
    );
  });
});
