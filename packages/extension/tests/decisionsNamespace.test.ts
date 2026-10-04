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
import type { Page as UnderstudyPage } from "../understudy/page.ts";

// stagehand.experimentalDecisions.* and the plain methods share services; what differs is the
// decision config each one hands over. These tests pin that hand-over at the RPC boundary.

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
  it("gives the decision config only to the namespace methods", async () => {
    const { router, services, close } = await setup({ apiKey: "decision-key", tools: true });

    await router.handle(call("stagehand.experimental_decisions_act", { instruction: "click it" }));
    await router.handle(call("stagehand.experimental_decisions_observe", { instruction: "find" }));
    await router.handle(call("stagehand.experimental_decisions_extract", { instruction: "get" }));

    const asked = {
      apiKey: "decision-key",
      tools: true,
      enabled: true,
      observe: true,
      extract: "pick",
    };
    expect(services.act.mock.calls[0][0].decisions).toStrictEqual(asked);
    expect(services.observe.mock.calls[0][0].decisions).toStrictEqual(asked);
    expect(services.extract.mock.calls[0][0].decisions).toStrictEqual(asked);
    await close();
  });

  it("keeps the plain methods on the LLM path when a decision config exists", async () => {
    const { router, services, close } = await setup({ apiKey: "decision-key", tools: true });

    await router.handle(call("stagehand.act", { instruction: "click it" }));
    await router.handle(call("stagehand.observe", { instruction: "find" }));
    await router.handle(call("stagehand.extract", { instruction: "get" }));

    // act keeps the config for its timing log, switched off; the others get nothing at all.
    expect(services.act.mock.calls[0][0].decisions).toMatchObject({ enabled: false });
    expect(services.observe.mock.calls[0][0].decisions).toBeUndefined();
    expect(services.extract.mock.calls[0][0].decisions).toBeUndefined();
    await close();
  });

  it("honours the configured extract mode", async () => {
    const { router, services, close } = await setup({ apiKey: "decision-key", extract: "judge" });

    await router.handle(call("stagehand.experimental_decisions_extract", { instruction: "get" }));

    expect(services.extract.mock.calls[0][0].decisions).toMatchObject({ extract: "judge" });
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
    expect(services.act.mock.calls[0][0].decisions).toBeUndefined();
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
  vi.spyOn(runtime, "resolveUnderstudyPage").mockReturnValue({} as UnderstudyPage);
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
