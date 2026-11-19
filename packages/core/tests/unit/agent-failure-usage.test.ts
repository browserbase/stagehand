import { describe, expect, it, vi } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { V3 } from "../../lib/v3/v3.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    wrapLanguageModel: vi.fn(({ model }) => model),
  };
});

import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";
import { AgentAbortError } from "../../lib/v3/types/public/sdkErrors.js";

type AgentLlmOptions = {
  onStepFinish?: (step: unknown) => Promise<void> | void;
};

const stepUsage = {
  inputTokens: 1200,
  outputTokens: 80,
  reasoningTokens: 10,
  cachedInputTokens: 200,
  totalTokens: 1290,
};

function createGotoStep() {
  return {
    text: "",
    toolCalls: [
      {
        type: "tool-call",
        toolCallId: "call_goto",
        toolName: "goto",
        input: { url: "https://example.com/next" },
      },
    ],
    toolResults: [
      {
        type: "tool-result",
        toolCallId: "call_goto",
        toolName: "goto",
        input: { url: "https://example.com/next" },
        output: { success: true },
      },
    ],
    finishReason: "tool-calls",
    usage: stepUsage,
  };
}

function createV3(awaitActivePage: () => Promise<unknown>) {
  return {
    context: { awaitActivePage: vi.fn(awaitActivePage) },
    isCaptchaAutoSolveEnabled: false,
    browserbaseApiKey: undefined,
    logger: vi.fn(),
    recordAgentReplayStep: vi.fn(),
    updateMetrics: vi.fn(),
    act: vi.fn(),
    extract: vi.fn(),
    observe: vi.fn(),
  } as unknown as V3;
}

function createLlmClient(
  generateText: (options: AgentLlmOptions) => Promise<unknown>,
) {
  const model = {
    modelId: "openai/gpt-5-mini",
    provider: "openai.responses",
    specificationVersion: "v2",
  } as unknown as LanguageModelV2;

  return {
    getLanguageModel: vi.fn(() => model),
    generateText: vi.fn(generateText),
  } as unknown as LLMClient;
}

const page = {
  url: () => "https://example.com",
  enableCursorOverlay: vi.fn(async () => {}),
};

const executeOptions = {
  instruction: "open the next page",
  maxSteps: 5,
  excludeTools: ["search"],
};

describe("v3 agent usage on failure", () => {
  it("reports usage from finished steps when the agent loop throws", async () => {
    const v3 = createV3(async () => page);
    const client = createLlmClient(async (options) => {
      await options.onStepFinish?.(createGotoStep());
      throw new Error("Target page, context or browser has been closed");
    });
    const handler = new V3AgentHandler(v3, vi.fn(), client);

    const result = await handler.execute(executeOptions);

    expect(result.success).toBe(false);
    expect(result.usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 80,
      reasoning_tokens: 10,
      cached_input_tokens: 200,
    });
    expect(result.usage?.inference_time_ms).toEqual(expect.any(Number));
    expect(v3.updateMetrics).toHaveBeenCalledWith(
      expect.anything(),
      1200,
      80,
      10,
      200,
      expect.any(Number),
    );
  });

  it("counts the step whose handler fails because the browser is gone", async () => {
    let calls = 0;
    const v3 = createV3(async () => {
      calls += 1;
      // First call builds the system prompt; the post-step page lookup fails.
      if (calls > 1) throw new Error("Session closed");
      return page;
    });
    const client = createLlmClient(async (options) => {
      await options.onStepFinish?.(createGotoStep());
      return {};
    });
    const handler = new V3AgentHandler(v3, vi.fn(), client);

    const result = await handler.execute(executeOptions);

    expect(result.success).toBe(false);
    expect(result.usage).toMatchObject({
      input_tokens: 1200,
      output_tokens: 80,
    });
  });

  it("records usage in metrics when the agent is aborted (e.g. timeout)", async () => {
    const v3 = createV3(async () => page);
    const controller = new AbortController();
    const client = createLlmClient(async (options) => {
      await options.onStepFinish?.(createGotoStep());
      controller.abort("timeout");
      throw new Error("aborted");
    });
    const handler = new V3AgentHandler(v3, vi.fn(), client);

    await expect(
      handler.execute({ ...executeOptions, signal: controller.signal }),
    ).rejects.toThrow(AgentAbortError);
    expect(v3.updateMetrics).toHaveBeenCalledWith(
      expect.anything(),
      1200,
      80,
      10,
      200,
      expect.any(Number),
    );
  });

  it("omits usage when no step finished", async () => {
    const v3 = createV3(async () => page);
    const client = createLlmClient(async () => {
      throw new Error("Model request failed");
    });
    const handler = new V3AgentHandler(v3, vi.fn(), client);

    const result = await handler.execute(executeOptions);

    expect(result.success).toBe(false);
    expect(result.usage).toBeUndefined();
    expect(v3.updateMetrics).not.toHaveBeenCalled();
  });
});
