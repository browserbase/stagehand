import { Output, generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAiSdkLanguageModel, generateWithAiSdk } from "../llm/aiSdkClient.js";
import { getAISDKLanguageModel } from "../llm/LLMProvider.js";
import { createProviderLanguageModel } from "../llm/providerRegistry.js";
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
      modelName: "openai/gpt-6-luna" as const,
      modelId: "gpt-6-luna",
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
      name: "xAI",
      modelName: "xai/grok-4.7" as const,
      modelId: "grok-4.7",
      provider: "xai.responses",
    },
    {
      name: "new OpenAI ID",
      modelName: "openai/gpt-6-astra" as const,
      modelId: "gpt-6-astra",
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
        modelName: "openai/gpt-6-luna",
        apiKey: "provider-secret",
      },
      { stopSequences: ["STOP"] },
    );

    expect(model).toMatchObject({
      provider: "openai.chat",
      modelId: "gpt-6-luna",
    });
  });

  it("uses the same xAI provider in the agent path", () => {
    expect(getAISDKLanguageModel("xai", "grok-4.7")).toMatchObject({
      provider: "xai.responses",
      modelId: "grok-4.7",
    });
  });

  it("rejects stop sequences for xAI before inference", () => {
    expect(() =>
      createAiSdkLanguageModel(
        { modelName: "xai/grok-4.7", apiKey: "provider-secret" },
        { stopSequences: ["STOP"] },
      ),
    ).toThrow("xAI Responses does not support stopSequences");
  });

  it("keeps Anthropic's browser header after provider construction", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        throw new Error("request intercepted");
      },
    );
    const model = createProviderLanguageModel("anthropic", "claude-sonnet-5-5", {
      apiKey: "provider-secret",
      headers: { "x-tenant-id": "tenant-123" },
      fetch,
    });

    await expect(
      model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }] }),
    ).rejects.toThrow("request intercepted");

    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("x-tenant-id")).toBe("tenant-123");
  });

  it("maps Stagehand function tools and structured output to xAI Responses", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
        throw new Error("request intercepted");
      },
    );
    const model = createProviderLanguageModel("xai", "grok-4.7", {
      apiKey: "provider-secret",
      fetch,
    });

    await expect(
      model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Find a button" }] }],
        tools: [
          {
            type: "function",
            name: "click",
            description: "Click a button",
            inputSchema: { type: "object", properties: { id: { type: "string" } } },
          },
        ],
        responseFormat: {
          type: "json",
          name: "action",
          schema: { type: "object", properties: { id: { type: "string" } } },
        },
      }),
    ).rejects.toThrow("request intercepted");

    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.tools).toContainEqual(expect.objectContaining({ type: "function", name: "click" }));
    expect(body.text?.format).toMatchObject({ type: "json_schema", name: "action" });
  });

  it("returns an upstream unknown-model error without replacing it", async () => {
    const upstreamError = new Error("xAI: model grok-unavailable was not found");
    vi.mocked(generateText).mockRejectedValue(upstreamError);

    await expect(
      llmService.generate(
        { modelName: "xai/grok-unavailable", apiKey: "provider-secret" },
        { messages: [{ role: "user", content: { type: "text", text: "Hello" } }] },
        vi.fn(),
      ),
    ).rejects.toBe(upstreamError);
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
        modelName: "openai/gpt-6-luna",
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
          modelId: "gpt-6-luna",
        }),
      }),
    );
  });

  it("routes xAI direct inference through its Responses provider", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Done",
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    } as never);

    await llmService.generate(
      { modelName: "xai/grok-4.7", apiKey: "provider-secret" },
      { messages: [{ role: "user", content: { type: "text", text: "Hello" } }] },
      vi.fn(),
    );

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({ provider: "xai.responses", modelId: "grok-4.7" }),
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
        modelName: "openai/gpt-6-luna",
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
