import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateObject } from "ai";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISdkClient } from "../../lib/v3/llm/aisdk.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: vi.fn(),
  };
});

const mockGenerateObject = vi.mocked(generateObject);

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
});
