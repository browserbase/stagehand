import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelConfigSchema } from "../../protocol/schemas.js";
import * as llmService from "../services/llmService.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn((options: unknown) => options),
  },
}));

const input = {
  messages: [{ role: "user" as const, content: { type: "text" as const, text: "Hi" } }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateText).mockResolvedValue({
    text: "Hello",
    output: undefined,
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  } as never);
});

describe("model gateway dispatch", () => {
  it("routes a Browserbase namespace model through the Browserbase gateway", async () => {
    const model = ModelConfigSchema.parse({
      modelName: "browserbase/openai/gpt-5.4-mini",
    });

    await llmService.generate(model, input, vi.fn(), {
      apiUrl: "https://api.stagehand.browserbase.com/v1",
      apiKey: "bb-api-key",
      sessionId: "session-123",
    });

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "openai/gpt-5.4-mini",
        }),
      }),
    );
  });

  it("rejects Browserbase namespace models without Browserbase session context", async () => {
    const model = ModelConfigSchema.parse({
      modelName: "browserbase/openai/gpt-5.4-mini",
    });

    await expect(llmService.generate(model, input, vi.fn())).rejects.toThrow(
      "Browserbase gateway inference requires a Browserbase API key and session",
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("routes custom endpoints through the OpenAI-compatible client", async () => {
    const model = ModelConfigSchema.parse({
      modelName: "customer-deployment-42",
      baseURL: "https://customer.example.com/v1",
      apiKey: "customer-key",
    });

    await llmService.generate(model, input, vi.fn());

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          provider: "openai.responses",
          modelId: "customer-deployment-42",
        }),
      }),
    );
  });
});
