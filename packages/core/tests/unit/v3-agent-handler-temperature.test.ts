import { beforeEach, describe, expect, it, vi } from "vitest";
import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  reasoningTokens: 0,
  cachedInputTokens: 0,
};

function createHandler(modelId: string) {
  const page = {
    url: () => "https://example.com",
  };
  const v3 = {
    context: {
      awaitActivePage: vi.fn().mockResolvedValue(page),
    },
    browserbaseApiKey: undefined as string | undefined,
    isCaptchaAutoSolveEnabled: false,
    updateMetrics: vi.fn(),
  };
  const languageModel = {
    provider: "mock",
    modelId,
    specificationVersion: "v2",
  };
  const llmClient = {
    getLanguageModel: vi.fn(() => languageModel),
    generateText: vi.fn(),
    streamText: vi.fn(),
  };
  const handler = new V3AgentHandler(v3 as never, vi.fn(), llmClient as never);

  (handler as unknown as { createTools: ReturnType<typeof vi.fn> }).createTools =
    vi.fn(() => ({}));
  (
    handler as unknown as { ensureDone: ReturnType<typeof vi.fn> }
  ).ensureDone = vi.fn(
    async (_state: unknown, _model: unknown, messages: unknown[]) => ({
      messages,
    }),
  );

  return { handler, llmClient };
}

describe("V3AgentHandler temperature compatibility", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("omits temperature for OpenAI reasoning models in execute()", async () => {
    const { handler, llmClient } = createHandler("openai/gpt-5.4-mini");
    llmClient.generateText.mockResolvedValue({
      text: "done",
      response: { messages: [] },
      steps: [],
      totalUsage: usage,
    });

    await handler.execute({
      instruction: "Say hello.",
      highlightCursor: false,
      maxSteps: 1,
    });

    expect(llmClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: undefined,
      }),
    );
  });

  it("preserves temperature for supported models in execute()", async () => {
    const { handler, llmClient } = createHandler(
      "anthropic/claude-haiku-4-5-20251001",
    );
    llmClient.generateText.mockResolvedValue({
      text: "done",
      response: { messages: [] },
      steps: [],
      totalUsage: usage,
    });

    await handler.execute({
      instruction: "Say hello.",
      highlightCursor: false,
      maxSteps: 1,
    });

    expect(llmClient.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 1,
      }),
    );
  });

  it("omits temperature for OpenAI reasoning models in stream()", async () => {
    const { handler, llmClient } = createHandler("openai/gpt-5.4-mini");
    const textStream = (async function* () {
      yield "done";
    })();

    llmClient.streamText.mockImplementation((options) => {
      void options.onFinish?.({
        text: "done",
        response: { messages: [] },
        steps: [],
        totalUsage: usage,
      });

      return {
        textStream,
        fullStream: textStream,
      };
    });

    const result = await handler.stream({
      instruction: "Say hello.",
      highlightCursor: false,
      maxSteps: 1,
    });
    await result.result;

    expect(llmClient.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: undefined,
      }),
    );
  });
});
