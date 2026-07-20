import { Output, generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import * as llmService from "../services/llmService.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options: unknown) => options),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AI SDK language models", () => {
  it.each([
    {
      name: "OpenAI",
      modelName: "openai/gpt-5.4-mini" as const,
      modelId: "gpt-5.4-mini",
      provider: "openai.responses",
    },
    {
      name: "Anthropic",
      modelName: "anthropic/claude-sonnet-4-6" as const,
      modelId: "claude-sonnet-4-6",
      provider: "anthropic.messages",
    },
    {
      name: "Google",
      modelName: "google/gemini-3-flash-preview" as const,
      modelId: "gemini-3-flash-preview",
      provider: "google.generative-ai",
    },
    {
      name: "Groq",
      modelName: "groq/openai/gpt-oss-120b" as const,
      modelId: "openai/gpt-oss-120b",
      provider: "groq.chat",
    },
    {
      name: "Cerebras",
      modelName: "cerebras/gpt-oss-120b" as const,
      modelId: "gpt-oss-120b",
      provider: "cerebras.chat",
    },
  ])("creates a direct $name model from its validated configuration", (testCase) => {
    const model = createAiSdkLanguageModel({
      modelName: testCase.modelName,
      apiKey: "provider-secret",
      headers: { "x-tenant-id": "tenant-123" },
    });

    expect(model).toMatchObject({
      provider: testCase.provider,
      modelId: testCase.modelId,
    });
  });

  it("routes a configured provider model through the AI SDK client", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Four",
      output: undefined,
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    await llmService.generate(
      {
        modelName: "openai/gpt-5.4-mini",
        apiKey: "provider-secret",
      },
      {
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
      },
      vi.fn(),
    );

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "gpt-5.4-mini",
        }),
      }),
    );
  });
});

describe("generateWithAiSdk", () => {
  it("converts a text AI SDK result into the Stagehand LLM result schema", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Four",
      output: undefined,
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    await expect(
      generateWithAiSdk({} as never, {
        systemPrompt: "Answer concisely.",
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
      }),
    ).resolves.toEqual({
      role: "assistant",
      content: { type: "text", text: "Four" },
      stopReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
      outputFormat: "text",
    });

    expect(generateText).toHaveBeenCalledWith({
      model: {},
      instructions: "Answer concisely.",
      messages: [{ role: "user", content: [{ type: "text", text: "What is 2 + 2?" }] }],
      temperature: undefined,
      stopSequences: undefined,
    });
  });

  it("validates structured output against the requested JSON schema", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      output: { answer: "Four" },
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    await expect(
      generateWithAiSdk({} as never, {
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
        responseFormat: {
          type: "json_schema",
          name: "answer",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
        },
      }),
    ).resolves.toMatchObject({
      outputFormat: "json_schema",
      structuredContent: { answer: "Four" },
    });

    expect(Output.object).toHaveBeenCalledOnce();
  });

  it("rejects structured output that does not match the requested JSON schema", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      output: { answer: 4 },
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    await expect(
      generateWithAiSdk({} as never, {
        messages: [{ role: "user", content: { type: "text", text: "What is 2 + 2?" } }],
        responseFormat: {
          type: "json_schema",
          name: "answer",
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("propagates AI SDK errors without wrapping them", async () => {
    const error = new Error("provider unavailable");
    vi.mocked(generateText).mockRejectedValue(error);

    await expect(
      generateWithAiSdk({} as never, {
        messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
      }),
    ).rejects.toBe(error);
  });
});
