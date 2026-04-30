import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { act, extract, observe } from "../../lib/inference.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { ClientOptions } from "../../lib/v3/types/public/model.js";

const usage = {
  prompt_tokens: 1,
  completion_tokens: 1,
  reasoning_tokens: 0,
  cached_input_tokens: 0,
  total_tokens: 2,
};

function createLlmClient(clientOptions?: ClientOptions) {
  const createChatCompletion = vi.fn(
    async ({
      options,
    }: {
      options: { response_model?: { name?: string } };
    }) => {
      const responseName = options.response_model?.name;
      if (responseName === "Observation") {
        return { data: { elements: [] }, usage };
      }
      if (responseName === "act") {
        return { data: { action: null, twoStep: false }, usage };
      }
      if (responseName === "Metadata") {
        return { data: { completed: true, progress: "done" }, usage };
      }
      return { data: { value: "ok" }, usage };
    },
  );

  return {
    type: "aisdk",
    modelName: "openai/gpt-5-mini",
    clientOptions,
    createChatCompletion,
  } as unknown as LLMClient & {
    createChatCompletion: typeof createChatCompletion;
  };
}

async function runPrimitiveCalls(llmClient: LLMClient) {
  const logger = vi.fn();

  await observe({
    instruction: "find the button",
    domElements: "button",
    llmClient,
    logger,
  });
  await act({
    instruction: "click the button",
    domElements: "button",
    llmClient,
    logger,
  });
  await extract({
    instruction: "extract the value",
    domElements: "value",
    schema: z.object({ value: z.string() }),
    llmClient,
    logger,
  });
}

describe("primitive inference temperature options", () => {
  it("omits temperature by default for act, observe, and extract calls", async () => {
    const llmClient = createLlmClient();

    await runPrimitiveCalls(llmClient);

    expect(llmClient.createChatCompletion).toHaveBeenCalledTimes(4);
    for (const call of llmClient.createChatCompletion.mock.calls) {
      expect(call[0].options).not.toHaveProperty("temperature");
    }
  });

  it("treats null temperature as omitted", async () => {
    const llmClient = createLlmClient({ temperature: null });

    await runPrimitiveCalls(llmClient);

    expect(llmClient.createChatCompletion).toHaveBeenCalledTimes(4);
    for (const call of llmClient.createChatCompletion.mock.calls) {
      expect(call[0].options).not.toHaveProperty("temperature");
    }
  });

  it("passes explicit numeric temperature through to primitive inference calls", async () => {
    const llmClient = createLlmClient({ temperature: 0.2 });

    await runPrimitiveCalls(llmClient);

    expect(llmClient.createChatCompletion).toHaveBeenCalledTimes(4);
    for (const call of llmClient.createChatCompletion.mock.calls) {
      expect(call[0].options).toHaveProperty("temperature", 0.2);
    }
  });
});
