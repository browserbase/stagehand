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

const { writeTimestampedTxtFile, appendSummary } = vi.hoisted(() => ({
  writeTimestampedTxtFile: vi.fn(() => ({
    fileName: "call.txt",
    timestamp: "20250705_120000",
  })),
  appendSummary: vi.fn(),
}));

vi.mock("../../lib/inferenceLogUtils.js", () => ({
  writeTimestampedTxtFile,
  appendSummary,
}));

import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";

type AgentLlmOptions = {
  onStepFinish?: (step: unknown) => Promise<void> | void;
  prepareStep?: (step: { messages: unknown[]; stepNumber: number }) =>
    | Promise<{ messages: unknown[]; stepNumber: number }>
    | {
        messages: unknown[];
        stepNumber: number;
      };
  onFinish?: (event: unknown) => void;
  onAbort?: (event: unknown) => void;
  onError?: (event: { error: unknown }) => void;
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
    await options.prepareStep?.({
      messages: [{ role: "user", content: "finish" }],
      stepNumber: 1,
    });
    await options.onStepFinish?.(doneStep);
    return createGenerateResult(doneStep);
  });

  const streamText = vi.fn((options: AgentLlmOptions) => {
    void (async () => {
      const doneStep = createDoneStep();
      await options.prepareStep?.({
        messages: [{ role: "user", content: "finish" }],
        stepNumber: 1,
      });
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

function createInferenceHandler(
  client: LLMClient,
  logger: (line: LogLine) => void,
) {
  return new V3AgentHandler(
    createV3(),
    logger,
    client,
    undefined,
    undefined,
    undefined,
    "dom",
    false,
    undefined,
    true,
  );
}

describe("V3AgentHandler inference logging", () => {
  let logger: (line: LogLine) => void;

  beforeEach(() => {
    logger = vi.fn();
    writeTimestampedTxtFile.mockClear();
    appendSummary.mockClear();
    writeTimestampedTxtFile.mockReturnValue({
      fileName: "call.txt",
      timestamp: "20250705_120000",
    });
  });

  it("writes agent inference files when logInferenceToFile is enabled", async () => {
    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_run_start",
      expect.objectContaining({
        instruction: "finish",
      }),
    );
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        step: 1,
      }),
    );
  });

  it("writes agent inference files when streaming with logInferenceToFile", async () => {
    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);

    const streamResult = await handler.stream({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });
    await streamResult.result;

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_run_start",
      expect.objectContaining({
        instruction: "finish",
      }),
    );
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        step: 1,
      }),
    );
  });

  it("handles prepareStep returning undefined without crashing", async () => {
    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
      callbacks: {
        prepareStep: async () => undefined as never,
      },
    });

    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        step: 1,
      }),
    );
  });

  it("logs per-step system and activeTools overrides from prepareStep", async () => {
    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
      callbacks: {
        prepareStep: async (step) => ({
          ...step,
          system: "step-specific system",
          activeTools: ["done"],
        }),
      },
    });

    expect(writeTimestampedTxtFile).toHaveBeenCalledWith(
      "agent_summary",
      "agent_step_1_call",
      expect.objectContaining({
        systemPrompt: "step-specific system",
        tools: ["done"],
      }),
    );
  });

  it("finalizes pending step inference when a stream errors", async () => {
    const model = {
      modelId: "openai/gpt-5-mini",
      provider: "openai",
      specificationVersion: "v2",
    } as unknown as LanguageModelV2;

    const streamText = vi.fn((options: AgentLlmOptions) => {
      void (async () => {
        await options.prepareStep?.({
          messages: [{ role: "user", content: "finish" }],
          stepNumber: 1,
        });
        options.onError?.({ error: new Error("provider timeout") });
      })();

      return {
        textStream: (async function* () {})(),
      };
    });

    const client = {
      getLanguageModel: vi.fn(() => model),
      generateText: vi.fn(),
      streamText,
    } as unknown as LLMClient;

    const handler = createInferenceHandler(client, logger);

    const streamResult = await handler.stream({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    await expect(streamResult.result).rejects.toThrow("provider timeout");
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        status: "failed",
        error: "provider timeout",
      }),
    );
  });

  it("records step responses when call file write fails", async () => {
    (writeTimestampedTxtFile as ReturnType<typeof vi.fn>).mockImplementation(
      (_directory: string, prefix: string) => {
        if (prefix.includes("_call")) {
          return null;
        }
        return {
          fileName: "response.txt",
          timestamp: "20250705_120008",
        };
      },
    );

    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        step: 1,
        LLM_input_file: "(call file unavailable)",
        LLM_output_file: "response.txt",
      }),
    );
  });

  it("finalizes pending step inference when a stream aborts", async () => {
    const model = {
      modelId: "openai/gpt-5-mini",
      provider: "openai",
      specificationVersion: "v2",
    } as unknown as LanguageModelV2;

    const streamText = vi.fn((options: AgentLlmOptions) => {
      void (async () => {
        await options.prepareStep?.({
          messages: [{ role: "user", content: "finish" }],
          stepNumber: 1,
        });
        options.onAbort?.({});
      })();

      return {
        textStream: (async function* () {})(),
      };
    });

    const client = {
      getLanguageModel: vi.fn(() => model),
      generateText: vi.fn(),
      streamText,
    } as unknown as LLMClient;

    const handler = createInferenceHandler(client, logger);

    const controller = new AbortController();
    controller.abort("user cancelled");

    const streamResult = await handler.stream({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
      signal: controller.signal,
    });

    await expect(streamResult.result).rejects.toThrow("user cancelled");
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        status: "failed",
        error: "user cancelled",
      }),
    );
  });

  it("finalizes pending step inference when execute fails", async () => {
    const model = {
      modelId: "openai/gpt-5-mini",
      provider: "openai",
      specificationVersion: "v2",
    } as unknown as LanguageModelV2;

    const generateText = vi.fn(async (options: AgentLlmOptions) => {
      await options.prepareStep?.({
        messages: [{ role: "user", content: "finish" }],
        stepNumber: 1,
      });
      throw new Error("provider timeout");
    });

    const client = {
      getLanguageModel: vi.fn(() => model),
      generateText,
      streamText: vi.fn(),
    } as unknown as LLMClient;

    const handler = createInferenceHandler(client, logger);

    const result = await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    expect(result.success).toBe(false);
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        status: "failed",
        error: "provider timeout",
      }),
    );
  });

  it("does not record a completed step after stream abort finalizes it", async () => {
    const model = {
      modelId: "openai/gpt-5-mini",
      provider: "openai",
      specificationVersion: "v2",
    } as unknown as LanguageModelV2;

    const streamText = vi.fn((options: AgentLlmOptions) => {
      void (async () => {
        await options.prepareStep?.({
          messages: [{ role: "user", content: "finish" }],
          stepNumber: 1,
        });
        options.onAbort?.({});
        await options.onStepFinish?.(createDoneStep());
      })();

      return {
        textStream: (async function* () {})(),
      };
    });

    const client = {
      getLanguageModel: vi.fn(() => model),
      generateText: vi.fn(),
      streamText,
    } as unknown as LLMClient;

    const handler = createInferenceHandler(client, logger);

    const streamResult = await handler.stream({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    await expect(streamResult.result).rejects.toThrow("Stream was aborted");
    expect(appendSummary).toHaveBeenCalledTimes(1);
    expect(appendSummary).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        agent_inference_type: "agent_step",
        status: "failed",
      }),
    );
  });

  it("sanitizes image payloads in prepareStep inference logs", async () => {
    const { client } = createLlmClient();
    const handler = createInferenceHandler(client, logger);
    const imageData = "A".repeat(2000);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
      callbacks: {
        prepareStep: async (step) => ({
          ...step,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "see this" },
                {
                  type: "image",
                  image: imageData,
                },
              ],
            },
          ],
        }),
      },
    });

    const stepCall = (
      writeTimestampedTxtFile as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      (call: [string, string, unknown]) => call[1] === "agent_step_1_call",
    );
    expect(stepCall).toBeDefined();
    expect(JSON.stringify(stepCall?.[2])).toContain("[image omitted");
  });
});
