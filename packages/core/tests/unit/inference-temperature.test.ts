import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { act, extract, observe } from "../../lib/inference.js";
import type {
  CreateChatCompletionOptions,
  LLMClient,
} from "../../lib/v3/llm/LLMClient.js";

type QueuedResponse = {
  data: unknown;
  usage?: Record<string, number>;
};

function createLlmClient(responses: QueuedResponse[]) {
  const calls: CreateChatCompletionOptions[] = [];
  const createChatCompletion = vi.fn(
    async (request: CreateChatCompletionOptions) => {
      calls.push(request);
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected LLM call");
      }
      return response;
    },
  );

  const llmClient = {
    type: "openai",
    modelName: "openai/gpt-5",
    createChatCompletion,
  } as unknown as LLMClient;

  return { llmClient, calls };
}

describe("shared act/extract/observe inference temperature", () => {
  it("does not pass temperature for either extract call", async () => {
    const { llmClient, calls } = createLlmClient([
      { data: { answer: "42" } },
      { data: { completed: true, progress: "complete" } },
    ]);

    await extract({
      instruction: "extract the answer",
      domElements: "body",
      schema: z.object({ answer: z.string() }),
      llmClient,
      logger: vi.fn(),
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].options).not.toHaveProperty("temperature");
    expect(calls[1].options).not.toHaveProperty("temperature");
  });

  it("does not pass temperature for observe", async () => {
    const { llmClient, calls } = createLlmClient([{ data: { elements: [] } }]);

    await observe({
      instruction: "find buttons",
      domElements: "body",
      llmClient,
      logger: vi.fn(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].options).not.toHaveProperty("temperature");
  });

  it("does not pass temperature for act", async () => {
    const { llmClient, calls } = createLlmClient([
      { data: { action: null, twoStep: false } },
    ]);

    await act({
      instruction: "click the button",
      domElements: "body",
      llmClient,
      logger: vi.fn(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].options).not.toHaveProperty("temperature");
  });
});
