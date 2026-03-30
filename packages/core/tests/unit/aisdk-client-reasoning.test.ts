import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObjectMock = vi.fn();

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    generateObject: generateObjectMock,
  };
});

const { AISdkClient } = await import("../../lib/v3/llm/aisdk.js");

describe("AISdkClient reasoning effort defaults", () => {
  it("uses low reasoning effort for openai/gpt-5.4 structured output calls", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { answer: "ok" },
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 2,
      },
      finishReason: "stop",
    });

    const client = new AISdkClient({
      model: { modelId: "openai/gpt-5.4" } as never,
    });

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
        response_model: {
          name: "Answer",
          schema: z.object({ answer: z.string() }),
        },
        temperature: 0,
      },
      logger: () => {},
    });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: expect.objectContaining({
            textVerbosity: "low",
            reasoningEffort: "low",
          }),
        },
      }),
    );
  });
});
