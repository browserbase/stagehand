import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "@browserbasehq/stagehand-protocol/schema-registry";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import { createStagehandRuntime, type StagehandBrowserSession } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";
import * as actService from "../services/actService.ts";
import * as extractService from "../services/extractService.ts";
import * as observeService from "../services/observeService.ts";
import { createStagehandTracingRuntime } from "../tracing.ts";
import type { Page } from "../understudy/page.ts";

// stagehand.experimentalDecisions.* and the plain methods share services; what differs is the
// drivers each one hands over. These tests pin that hand-over at the RPC boundary.

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 0,
};
const METADATA = { cache: { status: "DISABLED" as const }, usage: USAGE };

afterEach(() => vi.restoreAllMocks());

describe("stagehand.experimentalDecisions routing", () => {
  it("hands decision-first drivers to the services for namespace calls", async () => {
    const { router, services, close } = await setup({ apiKey: "decision-key", tools: true });

    await router.handle(call("stagehand.experimental_decisions_act", { instruction: "click it" }));
    await router.handle(call("stagehand.experimental_decisions_observe", { instruction: "find" }));
    await router.handle(call("stagehand.experimental_decisions_extract", { instruction: "get" }));

    expect(services.act.mock.calls[0][0]).toMatchObject({
      driver: { name: "decisions+llm", startsBeforeSettle: true },
      logTiming: true,
    });
    expect(services.act.mock.calls[0][0].cachedActionGuard).toBeUndefined();
    expect(services.observe.mock.calls[0][0].driver?.name).toBe("decisions+llm");
    expect(services.extract.mock.calls[0][0].driver?.name).toBe("decisions+llm");
    await close();
  });

  it("hands language-model drivers to the services for the plain methods", async () => {
    const { router, services, close } = await setup({ apiKey: "decision-key", tools: true });

    await router.handle(call("stagehand.act", { instruction: "click it" }));
    await router.handle(call("stagehand.observe", { instruction: "find" }));
    await router.handle(call("stagehand.extract", { instruction: "get" }));

    // A configured decision model changes one thing for the plain methods: act logs its timing.
    expect(services.act.mock.calls[0][0]).toMatchObject({
      driver: { name: "llm", startsBeforeSettle: false },
      logTiming: true,
    });
    expect(services.act.mock.calls[0][0].cachedActionGuard).toBeUndefined();
    expect(services.observe.mock.calls[0][0].driver?.name).toBe("llm");
    expect(services.extract.mock.calls[0][0].driver?.name).toBe("llm");
    await close();
  });

  it("composes the drivers from the configuration", async () => {
    const { router, services, close } = await setup({
      apiKey: "decision-key",
      extract: "judge",
      llmFallback: false,
      cacheCheck: true,
    });

    await router.handle(call("stagehand.experimental_decisions_act", { instruction: "click it" }));
    await router.handle(call("stagehand.experimental_decisions_observe", { instruction: "find" }));
    await router.handle(call("stagehand.experimental_decisions_extract", { instruction: "get" }));

    // No fallback: the decision drivers stand alone. "judge": the language model extracts.
    expect(services.act.mock.calls[0][0].driver?.name).toBe("decisions");
    expect(services.act.mock.calls[0][0].cachedActionGuard).toBeDefined();
    expect(services.observe.mock.calls[0][0].driver?.name).toBe("decisions");
    expect(services.extract.mock.calls[0][0].driver?.name).toBe("llm");
    await close();
  });

  it("rejects a namespace call when no decision config was given", async () => {
    const { router, services, close } = await setup(undefined);

    for (const operation of ["act", "observe", "extract"]) {
      await expect(
        router.handle(
          call(`stagehand.experimental_decisions_${operation}`, { instruction: "do it" }),
        ),
      ).rejects.toThrow(
        `stagehand.experimentalDecisions.${operation}() needs experimentalDecisions to be configured when Stagehand is created`,
      );
    }
    expect(services.act).not.toHaveBeenCalled();
    expect(services.observe).not.toHaveBeenCalled();
    expect(services.extract).not.toHaveBeenCalled();

    // The plain methods are unaffected.
    await expect(
      router.handle(call("stagehand.act", { instruction: "click it" })),
    ).resolves.toMatchObject({ data: { success: true } });
    expect(services.act.mock.calls[0][0]).toMatchObject({
      driver: { name: "llm" },
      logTiming: false,
    });
    await close();
  });

  it("records usage under the same metric names as the plain methods", async () => {
    const { router, runtime, close } = await setup({ apiKey: "decision-key" });
    const record = vi.spyOn(runtime.metrics, "record");

    await router.handle(call("stagehand.experimental_decisions_act", { instruction: "click it" }));
    await router.handle(call("stagehand.experimental_decisions_observe", { instruction: "find" }));
    await router.handle(call("stagehand.experimental_decisions_extract", { instruction: "get" }));

    expect(record.mock.calls.map(([operation]) => operation)).toStrictEqual([
      "act",
      "observe",
      "extract",
    ]);
    await close();
  });
});

let nextId = 1;

function call(method: string, params: Record<string, unknown>) {
  return StagehandRpcRequestSchema.parse({
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params: { page_id: "page-1", ...params },
  });
}

async function setup(experimentalDecisions: StagehandInitParams["experimentalDecisions"]) {
  const tracing = {
    ...createStagehandTracingRuntime({ registerGlobals: false }),
    configure: vi.fn(async () => {}),
  };
  const runtime = createStagehandRuntime(
    {
      browserSessionFactory: async () =>
        ({
          connected: true,
          pages: () => [],
          runWithTelemetryContext: (_scope: unknown, _logger: unknown, run: () => unknown) => run(),
          close: async () => {},
        }) as unknown as StagehandBrowserSession,
    },
    tracing,
  );
  await runtime.initialize({
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
    browserCdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
    logLevel: "info",
    model: { modelName: "openai/gpt-5.4-mini", apiKey: "test" },
    ...(experimentalDecisions ? { experimentalDecisions } : {}),
  });
  vi.spyOn(runtime, "resolveUnderstudyPage").mockReturnValue({} as Page);
  vi.spyOn(runtime, "resolvePage").mockReturnValue({} as ReturnType<typeof runtime.resolvePage>);
  const services = {
    act: vi.spyOn(actService, "act").mockResolvedValue({
      data: { success: true, message: "", actionDescription: "", actions: [] },
      metadata: METADATA,
    }),
    observe: vi.spyOn(observeService, "observe").mockResolvedValue({
      data: [],
      metadata: METADATA,
    }),
    extract: vi.spyOn(extractService, "extract").mockResolvedValue({
      data: { extraction: "" },
      metadata: METADATA,
    }),
  };
  return {
    router: new RPCRouter(runtime),
    runtime,
    services,
    close: async () => {
      await runtime.close();
      await tracing.shutdown();
    },
  };
}
