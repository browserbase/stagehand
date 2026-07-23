import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISdkClient } from "../../lib/v3/external_clients/aisdk.js";

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

describe("BYOC AISdkClient allowSystemInMessages", () => {
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
    const client = new AISdkClient({ model: createModel("openai/gpt-4.1") });

    await client.createChatCompletion({
      options: {
        messages: systemAndUserMessages,
        response_model: { name: "test", schema: z.object({ ok: z.boolean() }) },
        tools: [],
      },
      logger: vi.fn(),
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({ allowSystemInMessages: true }),
    );
  });

  it("passes allowSystemInMessages: true on the generateText (tool-calling) call", async () => {
    const client = new AISdkClient({ model: createModel("openai/gpt-4.1") });

    await client.createChatCompletion({
      options: {
        messages: systemAndUserMessages,
        tools: [],
      },
      logger: vi.fn(),
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ allowSystemInMessages: true }),
    );
  });
});
