import { Output, generateText } from "ai";
import { describe, expect, it, vi } from "vite-plus/test";
import { generateWithAiSdk } from "../llm/aiSdkClient.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options: unknown) => options),
  },
}));

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
