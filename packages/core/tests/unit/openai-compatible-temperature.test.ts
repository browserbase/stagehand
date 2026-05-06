import { describe, expect, it, vi } from "vitest";
import { CerebrasClient } from "../../lib/v3/llm/CerebrasClient.js";
import { GroqClient } from "../../lib/v3/llm/GroqClient.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";
import type { AvailableModel } from "../../lib/v3/types/public/model.js";

type OpenAICompatibleClient = LLMClient & {
  client: {
    chat: {
      completions: {
        create: ReturnType<typeof vi.fn>;
      };
    };
  };
};

function mockCompletionCreate() {
  return vi.fn().mockResolvedValue({
    id: "chatcmpl-test",
    choices: [
      {
        message: {
          role: "assistant",
          content: "ok",
          tool_calls: [],
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      total_tokens: 2,
    },
  });
}

function installMockClient(client: LLMClient) {
  const create = mockCompletionCreate();
  (client as OpenAICompatibleClient).client = {
    chat: {
      completions: {
        create,
      },
    },
  };
  return create;
}

const logger = vi.fn<(message: LogLine) => void>();

describe.each([
  [
    "GroqClient",
    () =>
      new GroqClient({
        modelName: "groq-test-model" as AvailableModel,
        clientOptions: { apiKey: "test-key" },
        logger,
      }),
  ],
  [
    "CerebrasClient",
    () =>
      new CerebrasClient({
        modelName: "cerebras-test-model" as AvailableModel,
        clientOptions: { apiKey: "test-key" },
        logger,
      }),
  ],
])("%s temperature handling", (_name, createClient) => {
  it("falls back to 0.7 when temperature is not provided", async () => {
    const client = createClient();
    const create = installMockClient(client);

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
      },
      logger,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
      }),
    );
  });

  it("preserves explicit temperature zero", async () => {
    const client = createClient();
    const create = installMockClient(client);

    await client.createChatCompletion({
      options: {
        messages: [{ role: "user", content: "hello" }],
        temperature: 0,
      },
      logger,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0,
      }),
    );
  });
});
