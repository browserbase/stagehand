import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowLogger } from "../../lib/v3/flowLogger.js";
import type { LLMClient } from "../../lib/v3/llm/LLMClient.js";
import type { AgentResult } from "../../lib/v3/types/public/agent.js";
import { V3 } from "../../lib/v3/v3.js";

function createMockLlmClient(): LLMClient {
  return {
    modelName: "mock/model",
  } as LLMClient;
}

async function createV3OutsideFlowContext(): Promise<V3> {
  return await new Promise((resolve) => {
    setImmediate(() => {
      resolve(
        new V3({
          env: "LOCAL",
          llmClient: createMockLlmClient(),
          verbose: 0,
        }),
      );
    });
  });
}

describe("FlowLogger agent context recovery", () => {
  let v3: V3 | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (v3) {
      await v3.close({ force: true });
      v3 = null;
    }
  });

  it("re-enters the V3 flow context for agent.execute() calls made outside the original ALS scope", async () => {
    v3 = await createV3OutsideFlowContext();
    const observedSessionIds: string[] = [];

    vi.spyOn(
      v3 as never as { prepareAgentExecution: () => Promise<unknown> },
      "prepareAgentExecution",
    ).mockResolvedValue({
      handler: {
        execute: vi.fn(async () => {
          FlowLogger.logLlmRequest({
            requestId: "req-1",
            model: "mock/model",
            prompt: "hello",
          });
          observedSessionIds.push(FlowLogger.currentContext.sessionId);

          return {
            success: true,
            actions: [],
            message: "ok",
            completed: true,
            messages: [],
          } satisfies AgentResult;
        }),
      },
      resolvedOptions: {
        instruction: "test instruction",
        toolTimeout: 45_000,
      },
      cacheContext: null,
      llmClient: v3.llmClient,
    });

    const agent = v3.agent();
    const result = await agent.execute("test instruction");

    expect(result).toMatchObject({
      success: true,
      message: "ok",
      completed: true,
    });
    expect(observedSessionIds).toEqual([v3.flowLoggerContext.sessionId]);
  });

  it("does not throw when an LLM log call is orphaned from FlowLogger ALS", () => {
    const stderrSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => {
      FlowLogger.logLlmRequest({
        requestId: "req-orphan",
        model: "mock/model",
        prompt: "hello",
      });
    }).not.toThrow();

    expect(stderrSpy).toHaveBeenCalled();
  });
});
