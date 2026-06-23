import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { LogLine } from "../../lib/v3/types/public/logs.js";
import type { V3 } from "../../lib/v3/v3.js";

// Make the module-level "ai" generateText (used only by the forced "done"
// finalization call) throw, while the main loop uses the injected LLMClient.
// Mirrors the provider rejecting the re-submitted history (STG-2335).
const finalizationError = Object.assign(
  new Error(
    "Invalid prompt: The messages must be a ModelMessage[]. If you have " +
      "passed a UIMessage[], you can use convertToModelMessages to convert them.",
  ),
  { cause: new Error("validation failed at messages[3]") },
);

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    wrapLanguageModel: vi.fn(({ model }) => model),
    generateText: vi.fn(async () => {
      throw finalizationError;
    }),
  };
});

import { V3AgentHandler } from "../../lib/v3/handlers/v3AgentHandler.js";

type AgentLlmOptions = {
  onStepFinish?: (step: unknown) => Promise<void> | void;
  onFinish?: (event: unknown) => void;
};

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  totalTokens: 2,
};

const emptyList = () => [] as unknown[];

// End-of-run step with no `done` call, so state.completed stays false and
// ensureDone proceeds to the forced finalization call (which throws).
function createNonDoneStep() {
  return {
    content: emptyList(),
    text: "",
    reasoning: emptyList(),
    reasoningText: undefined as string | undefined,
    files: emptyList(),
    sources: emptyList(),
    toolCalls: emptyList(),
    staticToolCalls: emptyList(),
    dynamicToolCalls: emptyList(),
    toolResults: emptyList(),
    staticToolResults: emptyList(),
    dynamicToolResults: emptyList(),
    finishReason: "stop",
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

function createGenerateResult(step: ReturnType<typeof createNonDoneStep>) {
  return {
    content: emptyList(),
    text: "",
    reasoning: emptyList(),
    reasoningText: undefined as string | undefined,
    files: emptyList(),
    sources: emptyList(),
    toolCalls: emptyList(),
    staticToolCalls: emptyList(),
    dynamicToolCalls: emptyList(),
    toolResults: emptyList(),
    staticToolResults: emptyList(),
    dynamicToolResults: emptyList(),
    finishReason: "stop",
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
    steps: [step],
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
    const step = createNonDoneStep();
    await options.onStepFinish?.(step);
    return createGenerateResult(step);
  });

  return {
    client: {
      getLanguageModel: vi.fn(() => model),
      generateText,
    } as unknown as LLMClient,
    generateText,
  };
}

describe("v3 agent finalization resilience", () => {
  let logger: (line: LogLine) => void;

  beforeEach(() => {
    logger = vi.fn();
  });

  it("returns a successful result when the forced done call fails", async () => {
    const { client } = createLlmClient();
    const handler = new V3AgentHandler(createV3(), logger, client);

    const result = await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    // A finalization failure must NOT flip a completed run to failure.
    expect(result.success).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.message).not.toMatch(/^Failed to execute task/);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("logs the finalization failure as a concise warning, not a red error", async () => {
    const lines: LogLine[] = [];
    const captureLogger = (line: LogLine) => {
      lines.push(line);
    };
    const { client } = createLlmClient();
    const handler = new V3AgentHandler(createV3(), captureLogger, client);

    await handler.execute({
      instruction: "finish",
      maxSteps: 1,
      excludeTools: ["search"],
    });

    const warning = lines.find((l) =>
      l.message.includes('Agent "done" finalization call failed'),
    );
    expect(warning).toBeDefined();
    // Warning (level 1), not error (level 0) — the run still succeeded.
    expect(warning?.level).toBe(1);
    // Cause is not logged (it would bloat the log); message stays short.
    expect(warning?.auxiliary).toBeUndefined();
    expect(warning?.message.length).toBeLessThan(500);
  });
});
