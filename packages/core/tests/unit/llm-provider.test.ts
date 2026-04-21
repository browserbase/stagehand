import type {
  LanguageModelV2,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAISDKLanguageModel } from "../../lib/v3/llm/LLMProvider.js";

const anthropicDoGenerate = vi.fn();
const anthropicDoStream = vi.fn();

function createMockAnthropicLanguageModel(modelId: string): LanguageModelV2 {
  return {
    specificationVersion: "v2",
    provider: "anthropic.messages",
    modelId,
    supportedUrls: {},
    doGenerate: anthropicDoGenerate,
    doStream: anthropicDoStream,
  } as unknown as LanguageModelV2;
}

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((modelId: string) =>
    createMockAnthropicLanguageModel(modelId),
  ),
  createAnthropic: vi.fn(
    () => (modelId: string) => createMockAnthropicLanguageModel(modelId),
  ),
}));

describe("getAISDKLanguageModel", () => {
  beforeEach(() => {
    anthropicDoGenerate.mockReset();
    anthropicDoStream.mockReset();

    anthropicDoGenerate.mockResolvedValue({
      content: [{ type: "text", text: "mock response" }],
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      warnings: [],
    });

    anthropicDoStream.mockResolvedValue({
      stream: new ReadableStream<LanguageModelV2StreamPart>({
        start(controller) {
          controller.enqueue({
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
          });
          controller.close();
        },
      }),
    });
  });

  describe("ollama provider", () => {
    it("works without clientOptions", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2");
      expect(model).toBeDefined();
    });

    it("works with empty clientOptions", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {});
      expect(model).toBeDefined();
    });

    it("works with clientOptions containing only undefined values", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: undefined,
      });
      expect(model).toBeDefined();
    });

    it("works with clientOptions containing only null values", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: null as unknown as string,
      });
      expect(model).toBeDefined();
    });

    it("works with custom baseURL", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        baseURL: "http://custom-ollama:11434",
      });
      expect(model).toBeDefined();
    });

    it("works even when apiKey is mistakenly provided", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: "unnecessary-key",
      });
      expect(model).toBeDefined();
    });
  });

  describe("providers with API keys", () => {
    it("openai requires valid clientOptions for custom configuration", () => {
      const defaultModel = getAISDKLanguageModel("openai", "gpt-4o");
      expect(defaultModel).toBeDefined();

      const customModel = getAISDKLanguageModel("openai", "gpt-4o", {
        apiKey: "test-key",
      });
      expect(customModel).toBeDefined();
    });
  });

  describe("hasValidOptions logic", () => {
    it("treats undefined apiKey as no options", () => {
      const model = getAISDKLanguageModel("ollama", "llama3.2", {
        apiKey: undefined,
      });
      expect(model).toBeDefined();
    });
  });

  describe("anthropic opus 4.7 temperature handling", () => {
    it("strips temperature for generate calls", async () => {
      const model = getAISDKLanguageModel("anthropic", "claude-opus-4-7");

      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        temperature: 0.2,
      });

      expect(anthropicDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: undefined,
        }),
      );
    });

    it("keeps temperature intact for other anthropic models", async () => {
      const model = getAISDKLanguageModel(
        "anthropic",
        "claude-sonnet-4-20250514",
      );

      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        temperature: 0.2,
      });

      expect(anthropicDoGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.2,
        }),
      );
    });

    it("keeps caller middleware composed after the temperature strip", async () => {
      const seenTemperatures: Array<number | undefined> = [];
      const callerMiddleware = {
        wrapGenerate: async ({
          doGenerate,
          params,
        }: {
          doGenerate: () => ReturnType<LanguageModelV2["doGenerate"]>;
          params: Parameters<LanguageModelV2["doGenerate"]>[0];
        }) => {
          seenTemperatures.push(params.temperature);
          return doGenerate();
        },
      };

      const model = getAISDKLanguageModel(
        "anthropic",
        "claude-opus-4-7",
        undefined,
        callerMiddleware,
      );

      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        temperature: 0.3,
      });

      expect(seenTemperatures).toEqual([undefined]);
    });

    it("strips temperature for stream calls", async () => {
      const model = getAISDKLanguageModel("anthropic", "claude-opus-4-7");

      await model.doStream({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
          },
        ],
        temperature: 0.2,
      });

      expect(anthropicDoStream).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: undefined,
        }),
      );
    });
  });
});
