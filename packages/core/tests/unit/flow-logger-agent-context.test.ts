import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyEventStore, getEventStore } from "../../lib/v3/eventStore.js";
import { FlowLogger, type FlowLoggerContext } from "../../lib/v3/flowLogger.js";
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
    await destroyEventStore();
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
      instruction: "test instruction",
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
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => {
      FlowLogger.logLlmRequest({
        requestId: "req-orphan",
        model: "mock/model",
        prompt: "hello",
      });
    }).not.toThrow();
  });

  it("records the orphan root event before an orphaned LLM event", async () => {
    const recordedTypes: string[] = [];
    const unsubscribe = getEventStore().subscribe({}, (event) => {
      recordedTypes.push(event.eventType);
    });

    try {
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      FlowLogger.logLlmRequest({
        requestId: "req-recorded",
        model: "mock/model",
        prompt: "hello",
      });
    } finally {
      unsubscribe();
    }

    expect(recordedTypes).toEqual([
      "FlowLoggerOrphanRootEvent",
      "LlmRequestEvent",
    ]);
  });

  it("records a placeholder root before rootless CDP events", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const sessionId = "cdp-rootless-session";
    const eventBus = new EventEmitter();
    await getEventStore().initializeSession(sessionId);
    getEventStore().attachBus(sessionId, eventBus);

    const context: FlowLoggerContext = {
      sessionId,
      eventBus,
      parentEvents: [],
    };

    const cdpEvent = FlowLogger.logCdpCallEvent(context, {
      method: "Page.navigate",
      params: { url: "https://example.com" },
    });
    const events = await getEventStore().listEvents({ sessionId });

    expect(events.map((event) => event.eventType)).toEqual([
      "FlowLoggerOrphanRootEvent",
      "CdpCallEvent",
    ]);
    expect(cdpEvent?.eventParentIds).toEqual([events[0]!.eventId]);
  });
});
