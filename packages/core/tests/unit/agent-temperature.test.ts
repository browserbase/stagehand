import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";
import type { V3 } from "../../lib/v3/v3.js";

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    wrapLanguageModel: vi.fn(({ model }) => model),
  };
});

import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";

type AgentLlmOptions = {
  onStepFinish?: (step: unknown) => Promise<void> | void;
  onFinish?: (event: unknown) => void;
  providerOptions?: Record<string, unknown>;
  temperature?: number;
};

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 2,
};

const emptyList = () => [] as unknown[];

function createDoneStep() {
  return {
    content: emptyList(),
    text: "",
    reasoning: emptyList(),
    reasoningText: undefined as string | undefined,
    files: emptyList(),
    sources: emptyList(),
    toolCalls: [
      {
        type: "tool-call",
        toolCallId: "call_done",
        toolName: "done",
        input: {
          reasoning: "Task completed",
          taskComplete: true,
        },
      },
    ],
    staticToolCalls: emptyList(),
    dynamicToolCalls: emptyList(),
    toolResults: [
      {
        type: "tool-result",
        toolCallId: "call_done",
        toolName: "done",
        input: {
          reasoning: "Task completed",
          taskComplete: true,
        },
        output: {
          success: true,
          reasoning: "Task completed",
          taskComplete: true,
        },
      },
    ],
    staticToolResults: emptyList(),
    dynamicToolResults: emptyList(),
    finishReason: "tool-calls",
    usage,
    warnings: undefined as unknown,
    request: {},
    response: {
      id: "response-id",
      modelId: "openai/gpt-5-mini",
      timestamp: new Date(0),
      messages: emptyList(),
    },
    providerMetadata: undefined as unknown,
  };
}

function createGenerateResult(doneStep: ReturnType<typeof createDoneStep>) {
  return {
    content: emptyList(),
    text: "",
    reasoning: emptyList(),
    reasoningText: undefined as string | undefined,
    files: emptyList(),
    sources: emptyList(),
    toolCalls: doneStep.toolCalls,
    staticToolCalls: emptyList(),
    dynamicToolCalls: emptyList(),
    toolResults: doneStep.toolResults,
    staticToolResults: emptyList(),
    dynamicToolResults: emptyList(),
    finishReason: "tool-calls",
    usage,
    totalUsage: usage,
    warnings: undefined as unknown,
    request: {},
    response: {
      id: "response-id",
      modelId: "openai/gpt-5-mini",
      timestamp: new Date(0),
      messages: emptyList(),
    },
    providerMetadata: undefined as unknown,
    steps: [doneStep],
    experimental_output: undefined as unknown,
  };
}

function createV3() {
  const page = {
    url: () => "https://example.com",
    enableCursorOverlay: vi.fn(async () => {}),
  };

  return {
    context: {
      awaitActivePage: vi.fn(async () => page),
    },
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

function createLlmClient() {
  const model = {
    modelId: "openai/gpt-5-mini",
    provider: "openai",
    specificationVersion: "v2",
  } as unknown as LanguageModelV2;

  const generateText = vi.fn(async (options: AgentLlmOptions) => {
    const doneStep = createDoneStep();
    await options.onStepFinish?.(doneStep);
    return createGenerateResult(doneStep);
  });

  const streamText = vi.fn((options: AgentLlmOptions) => {
    void (async () => {
      const doneStep = createDoneStep();
      await options.onStepFinish?.(doneStep);
      options.onFinish?.(createGenerateResult(doneStep));
    })();

    return {
      textStream: (async function* () {})(),
    };
  });

  return {
    client: {
      getLanguageModel: vi.fn(() => model),
      generateText,
      streamText,
    } as unknown as LLMClient,
    generateText,
    streamText,
  };
}

describe("v3 agent temperature options", () => {
  let logger: (line: LogLine) => void;

  beforeEach(() => {
    logger = vi.fn();
  });

  it("does not pass a temperature setting to non-streaming agent generation", async () => {
    const { client, generateText } = createLlmClient();
    const handler = new V3AgentHandler(createV3(), logger, client);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    const options = generateText.mock.calls[0][0] as AgentLlmOptions;
    expect(options).not.toHaveProperty("temperature");
    expect(options.providerOptions).toEqual({
      google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
      openai: { store: false },
    });
  });

  it("does not pass a temperature setting to streaming agent generation", async () => {
    const { client, streamText } = createLlmClient();
    const handler = new V3AgentHandler(createV3(), logger, client);

    const streamResult = await handler.stream({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });
    await streamResult.result;

    expect(streamText).toHaveBeenCalledTimes(1);
    const options = streamText.mock.calls[0][0] as AgentLlmOptions;
    expect(options).not.toHaveProperty("temperature");
    expect(options.providerOptions).toEqual({
      google: { mediaResolution: "MEDIA_RESOLUTION_HIGH" },
      openai: { store: false },
    });
  });
});
