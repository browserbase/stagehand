import { Output, generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import * as llmService from "../services/llmService.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => schema),
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
    {
      name: "OrcaRouter",
      modelName: "orcarouter/auto" as const,
      modelId: "orcarouter/auto",
      provider: "openai.responses",
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

  it("uses Chat Completions for OpenAI requests with stop sequences", () => {
    const model = createAiSdkLanguageModel(
      {
        modelName: "openai/gpt-5.4-mini",
        apiKey: "provider-secret",
      },
      { stopSequences: ["STOP"] },
    );

    expect(model).toMatchObject({
      provider: "openai.chat",
      modelId: "gpt-5.4-mini",
    });
  });

  it("uses Chat Completions for OrcaRouter requests with stop sequences", () => {
    const model = createAiSdkLanguageModel(
      {
        modelName: "orcarouter/fusion",
        apiKey: "provider-secret",
      },
      { stopSequences: ["STOP"] },
    );

    expect(model).toMatchObject({
      provider: "openai.chat",
      modelId: "orcarouter/fusion",
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

  it("routes OpenAI stop sequences through Chat Completions", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      output: undefined,
      finishReason: "stop",
      usage: {
        inputTokens: 3,
        outputTokens: 1,
        totalTokens: 4,
      },
    } as never);

    await llmService.generate(
      {
        modelName: "openai/gpt-5.4-mini",
        apiKey: "provider-secret",
      },
      {
        messages: [{ role: "user", content: { type: "text", text: "Stop before END" } }],
        stopSequences: ["END"],
      },
      vi.fn(),
    );

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: "openai.chat" }),
        stopSequences: ["END"],
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
      tools: undefined,
      toolChoice: undefined,
    });
  });

  it("forwards tools and tool choice", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "",
      output: undefined,
      finishReason: "tool-calls",
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "get_weather",
          input: { city: "Zurich" },
        },
      ],
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    const result = await generateWithAiSdk({} as never, {
      messages: [{ role: "user", content: { type: "text", text: "Check the weather" } }],
      tools: [
        {
          name: "get_weather",
          description: "Gets the weather",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
        },
      ],
      toolChoice: { mode: "required" },
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: {
          get_weather: expect.objectContaining({
            description: "Gets the weather",
          }),
        },
        toolChoice: "required",
      }),
    );
    expect(result.content).toEqual([
      { type: "text", text: "" },
      {
        type: "tool_use",
        id: "call-1",
        name: "get_weather",
        input: { city: "Zurich" },
      },
    ]);
  });

  it("converts protocol image blocks into AI SDK image parts", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Screenshot heading",
      output: undefined,
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        totalTokens: 15,
      },
    } as never);

    await generateWithAiSdk({} as never, {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the heading" },
            {
              type: "image",
              data: "iVBORw0KGgo=",
              mimeType: "image/png",
            },
          ],
        },
      ],
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extract the heading" },
              {
                type: "image",
                image: "iVBORw0KGgo=",
                mediaType: "image/png",
              },
            ],
          },
        ],
      }),
    );
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
