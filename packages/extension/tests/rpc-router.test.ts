import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.ts";
import { DEFAULT_EXTRACT_JSON_SCHEMA, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import { StagehandMetricsAccumulator } from "../metrics.ts";
import { createStagehandRuntime } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";
import { createStagehandTracingRuntime, type StagehandTracing } from "../tracing.ts";

const EMPTY_METRICS = new StagehandMetricsAccumulator().snapshot();

describe("Stagehand RPC router", () => {
  it("creates one server span for every valid JSON-RPC request", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    const router = createRouter(tracing);

    await expect(
      router.handle(request({ id: 10, method: "stagehand.metrics", params: {} })),
    ).resolves.toStrictEqual(EMPTY_METRICS);
    await tracing.forceFlush();

    expect(spans.getFinishedSpans()).toContainEqual(
      expect.objectContaining({
        name: "stagehand.metrics",
        kind: SpanKind.SERVER,
        attributes: expect.objectContaining({
          "rpc.system.name": "jsonrpc",
          "rpc.method": "stagehand.metrics",
          "jsonrpc.request.id": "10",
        }) as object,
      }),
    );
    await tracing.shutdown();
  });

  it("continues incoming W3C trace context even when the remote parent is unsampled", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    const router = createRouter(tracing);

    await expect(
      router.handle(
        request({
          id: 11,
          method: "stagehand.metrics",
          params: {},
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
          tracestate: "vendor=value",
        }),
      ),
    ).resolves.toStrictEqual(EMPTY_METRICS);
    await tracing.forceFlush();

    const span = spans
      .getFinishedSpans()
      .find(
        (candidate) => candidate.name === "stagehand.metrics" && candidate.kind === SpanKind.SERVER,
      );
    expect(span?.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(span?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(span?.parentSpanContext?.isRemote).toBe(true);
    expect(span?.parentSpanContext?.traceState?.get("vendor")).toBe("value");
    await tracing.shutdown();
  });

  it("marks failed routed requests as failed spans", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    const router = createRouter(tracing);

    await expect(
      router.handle(request({ id: 12, method: "page.url", params: { page_id: "missing" } })),
    ).rejects.toThrow();
    await tracing.forceFlush();

    const span = spans
      .getFinishedSpans()
      .find((candidate) => candidate.name === "page.url" && candidate.kind === SpanKind.SERVER);
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(span?.attributes["error.type"]).toBeDefined();
    await tracing.shutdown();
  });

  it("ends the final Stagehand span before tracing shuts down", async () => {
    const lifecycle: string[] = [];
    const processor: SpanProcessor = {
      forceFlush: async () => {},
      onEnd: (span) => lifecycle.push(`ended:${span.name}`),
      onStart: () => {},
      shutdown: async () => {
        lifecycle.push("shutdown");
      },
    };
    const tracing = configuredTracing(
      createStagehandTracingRuntime({ registerGlobals: false }, { spanProcessors: [processor] }),
    );
    const router = createRouter(tracing);

    await expect(
      router.handle(request({ id: 13, method: "stagehand.close", params: {} })),
    ).resolves.toStrictEqual({ closed: true });

    expect(lifecycle.slice(-2)).toStrictEqual(["ended:stagehand.close", "shutdown"]);
  });

  it("keeps filtered log spans under the JSON-RPC request span", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    const router = createRouter(tracing);

    await expect(
      router.handle(request({ id: 14, method: "stagehand.metrics", params: {} })),
    ).resolves.toStrictEqual(EMPTY_METRICS);
    await tracing.forceFlush();

    const requestSpan = spans
      .getFinishedSpans()
      .find((span) => span.name === "stagehand.metrics" && span.kind === SpanKind.SERVER);
    const logSpan = spans
      .getFinishedSpans()
      .find((span) => span.attributes["stagehand.span.type"] === "log");
    expect(logSpan?.spanContext().traceId).toBe(requestSpan?.spanContext().traceId);
    expect(logSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    await tracing.shutdown();
  });

  it("applies the init log level before logging and delegates lifecycle overrides", async () => {
    const tracing = configuredTracing(createStagehandTracingRuntime({ registerGlobals: false }));
    const logs: string[] = [];
    const initializeStagehand = vi.fn(async () => ({ initialized: true as const, pages: [] }));
    const closeStagehand = vi.fn(async () => {});
    const runtime = createStagehandRuntime(
      {
        emitLog: (log) => logs.push(log.message),
      },
      tracing,
    );
    const router = new RPCRouter(runtime, { initializeStagehand, closeStagehand });
    const initRequest = request({
      id: 15,
      method: "stagehand.init",
      params: {
        protocol_version: STAGEHAND_PROTOCOL_VERSION,
        client_info: { name: "stagehand-sdk-ts", version: "4.0.0" },
        browser_cdp_url: "ws://127.0.0.1:9222/devtools/browser/session",
        log_level: "off",
      },
    });

    await expect(router.handle(initRequest)).resolves.toStrictEqual({
      initialized: true,
      pages: [],
    });
    expect(logs).not.toContain("stagehand.init");
    expect(initializeStagehand).toHaveBeenCalledOnce();
    expect(initializeStagehand).toHaveBeenCalledWith(initRequest.params);

    await expect(
      router.handle(request({ id: 16, method: "stagehand.close", params: {} })),
    ).resolves.toStrictEqual({ closed: true });
    expect(closeStagehand).toHaveBeenCalledOnce();
  });

  it("applies the default schema to extract requests that omit it", async () => {
    const tracing = configuredTracing(createStagehandTracingRuntime({ registerGlobals: false }));
    const router = createRouter(tracing);
    const extract = vi.spyOn(router.stagehandController, "extract").mockResolvedValue({
      data: { extraction: "Example" },
      metadata: {
        cache: { status: "DISABLED" },
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          cachedInputTokens: 0,
          inferenceTimeMs: 0,
        },
      },
    });

    await router.handle(
      request({
        id: 17,
        method: "stagehand.extract",
        params: { page_id: "page-1", instruction: "Extract the page text" },
      }),
    );

    expect(extract).toHaveBeenCalledWith(
      {
        pageId: "page-1",
        instruction: "Extract the page text",
        schema: DEFAULT_EXTRACT_JSON_SCHEMA,
      },
      expect.anything(),
    );
    await tracing.shutdown();
  });
});

function createRouter(tracing: StagehandTracing): RPCRouter {
  return new RPCRouter(
    createStagehandRuntime(
      {
        browserSessionFactory: async () => {
          throw new Error("Stagehand browser session factory is not configured");
        },
      },
      tracing,
    ),
  );
}

function request(input: {
  id: number;
  method: string;
  params: Record<string, unknown>;
  traceparent?: string;
  tracestate?: string;
}) {
  return StagehandRpcRequestSchema.parse({ jsonrpc: "2.0", ...input });
}

function configuredTracing(
  runtime: ReturnType<typeof createStagehandTracingRuntime>,
): StagehandTracing {
  return { ...runtime, configure: () => {} };
}
