import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.ts";
import { DEFAULT_EXTRACT_JSON_SCHEMA, STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.ts";
import { StagehandMetricsAccumulator } from "../metrics.ts";
import { StagehandProtocolCompatibilityError } from "../errors.ts";
import { createStagehandRuntime, type StagehandBrowserSession } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";
import * as actService from "../services/actService.ts";
import { createStagehandTracingRuntime, type StagehandTracing } from "../tracing.ts";
import { CdpConnection } from "../understudy/cdp.ts";
import type { CdpWebSocketCloseEvent, CdpWebSocketTransport } from "../understudy/cdp.ts";
import type { Page } from "../understudy/page.ts";

const EMPTY_METRICS = new StagehandMetricsAccumulator().snapshot();

afterEach(() => vi.restoreAllMocks());

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

  it("ends the Stagehand close span before flushing reusable tracing", async () => {
    const lifecycle: string[] = [];
    const processor: SpanProcessor = {
      forceFlush: async () => {
        lifecycle.push("flush");
      },
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

    const closeRequest = request({ id: 13, method: "stagehand.close", params: {} });
    await expect(router.handle(closeRequest)).resolves.toStrictEqual({ closed: true });

    expect(lifecycle.at(-1)).toBe("ended:stagehand.close");
    await router.beforeResponse(closeRequest);

    expect(lifecycle.slice(-2)).toStrictEqual(["ended:stagehand.close", "flush"]);
    await tracing.shutdown();
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

  it("wraps top-level AI methods in operation spans", async () => {
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
          id: 15,
          method: "stagehand.act",
          params: { page_id: "missing", instruction: "click the link" },
        }),
      ),
    ).rejects.toThrow("Stagehand must be initialized before acting");
    await tracing.forceFlush();

    const requestSpan = spans
      .getFinishedSpans()
      .find((span) => span.name === "stagehand.act" && span.kind === SpanKind.SERVER);
    const operationSpan = spans
      .getFinishedSpans()
      .find((span) => span.attributes["stagehand.span.type"] === "operation");
    expect(operationSpan?.name).toBe("stagehand.act");
    expect(operationSpan?.status.code).toBe(SpanStatusCode.ERROR);
    expect(operationSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    await tracing.shutdown();
  });

  it("parents successful AI operation and CDP spans under the caller trace", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    let connection!: CdpConnection;
    const runtime = createStagehandRuntime(
      {
        browserSessionFactory: async (_cdpUrl, logger) => {
          connection = new CdpConnection(new ImmediateResponseTransport(), logger);
          return browserSessionFor(connection);
        },
      },
      tracing,
    );
    await runtime.initialize({
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
      browserCdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
      logLevel: "info",
      model: { modelName: "openai/gpt-5.4-mini", apiKey: "test" },
      telemetry: { traces: { endpoint: "https://collector.test/v1/traces", headers: {} } },
    });
    vi.spyOn(runtime, "resolveUnderstudyPage").mockReturnValue({} as Page);
    vi.spyOn(actService, "act").mockImplementation(async () => {
      await connection.send("Runtime.evaluate");
      return {
        data: { success: true, message: "", actionDescription: "", actions: [] },
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
      };
    });
    const router = new RPCRouter(runtime);

    await expect(
      router.handle(
        request({
          id: 16,
          method: "stagehand.act",
          params: { page_id: "page-1", instruction: "click the link" },
          traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        }),
      ),
    ).resolves.toMatchObject({ data: { success: true } });
    await tracing.forceFlush();

    const requestSpan = spans
      .getFinishedSpans()
      .find((span) => span.name === "stagehand.act" && span.kind === SpanKind.SERVER);
    const operationSpan = spans
      .getFinishedSpans()
      .find((span) => span.attributes["stagehand.span.type"] === "operation");
    const cdpSpans = spans
      .getFinishedSpans()
      .filter((span) => String(span.attributes["stagehand.log.message"]).startsWith("CDP "));
    expect(requestSpan?.spanContext().traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(requestSpan?.parentSpanContext?.spanId).toBe("00f067aa0ba902b7");
    expect(operationSpan?.spanContext().traceId).toBe(requestSpan?.spanContext().traceId);
    expect(operationSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    expect(cdpSpans.map((span) => span.name)).toStrictEqual(["CDP call", "CDP response"]);
    for (const span of cdpSpans) {
      expect(span.spanContext().traceId).toBe(operationSpan?.spanContext().traceId);
      expect(span.parentSpanContext?.spanId).toBe(operationSpan?.spanContext().spanId);
    }

    await runtime.close();
    await tracing.shutdown();
  });

  it("applies the init log level before logging and delegates lifecycle overrides", async () => {
    const configureTracing = vi.fn();
    const tracing = {
      ...configuredTracing(createStagehandTracingRuntime({ registerGlobals: false })),
      configure: configureTracing,
    };
    const logs: string[] = [];
    const initializeStagehand = vi.fn(async () => {
      expect(configureTracing).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ name: "stagehand-sdk-ts", version: "4.0.0" }),
      );
      return { initialized: true as const, pages: [] };
    });
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

    const closeRequest = request({ id: 16, method: "stagehand.close", params: {} });
    await expect(router.handle(closeRequest)).resolves.toStrictEqual({ closed: true });
    expect(closeStagehand).toHaveBeenCalledOnce();

    await router.beforeResponse(closeRequest);
    expect(closeStagehand).toHaveBeenCalledOnce();
  });

  it.each([
    ["1.1.0", "protocol-server-too-old"],
    ["2.0.0", "protocol-major-mismatch"],
    ["1.0.0-beta.1", "protocol-prerelease-mismatch"],
  ] as const)("rejects incompatible client protocol %s", async (protocolVersion, reason) => {
    const initializeStagehand = vi.fn(async () => ({ initialized: true as const, pages: [] }));
    const router = new RPCRouter(createStagehandRuntime(), { initializeStagehand });

    const result = router.handle(
      request({
        id: 16,
        method: "stagehand.init",
        params: {
          protocol_version: protocolVersion,
          client_info: { name: "stagehand-sdk-ts", version: "4.0.0" },
        },
      }),
    );
    await expect(result).rejects.toEqual(new StagehandProtocolCompatibilityError(reason));
    expect(initializeStagehand).not.toHaveBeenCalled();
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

  it("routes page event subscriptions through the page controller", async () => {
    const tracing = configuredTracing(createStagehandTracingRuntime({ registerGlobals: false }));
    const router = createRouter(tracing);
    const on = vi.spyOn(router.pageController, "on").mockResolvedValue({ ok: true });
    const off = vi.spyOn(router.pageController, "off").mockResolvedValue({ ok: true });

    await expect(
      router.handle(
        request({
          id: 18,
          method: "page.on",
          params: {
            page_id: "page-1",
            subscription_id: "subscription-1",
            event: "console",
          },
        }),
      ),
    ).resolves.toStrictEqual({ ok: true });
    await expect(
      router.handle(
        request({
          id: 19,
          method: "page.off",
          params: { subscription_id: "subscription-1" },
        }),
      ),
    ).resolves.toStrictEqual({ ok: true });

    expect(on).toHaveBeenCalledWith(
      {
        pageId: "page-1",
        subscriptionId: "subscription-1",
        event: "console",
      },
      expect.anything(),
    );
    expect(off).toHaveBeenCalledWith({ subscriptionId: "subscription-1" }, expect.anything());
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
  return { ...runtime, configure: vi.fn(async () => {}) };
}

function browserSessionFor(connection: CdpConnection): StagehandBrowserSession {
  return {
    connected: true,
    pages: () => [],
    newPage: async () => {
      throw new Error("Not used by this test");
    },
    activePage: async () => undefined,
    setActivePage: async () => {},
    addInitScript: async () => {},
    setExtraHTTPHeaders: async () => {},
    getDomainPolicy: () => null,
    setDomainPolicy: async () => {},
    cookies: async () => [],
    addCookies: async () => {},
    clearCookies: async () => {},
    clipboard: {
      readText: async () => "",
      writeText: async () => {},
      clear: async () => {},
      paste: async () => {},
      copy: async () => {},
      cut: async () => {},
    },
    runWithTelemetryContext: (scope, logger, run) =>
      connection.runWithTelemetryContext(scope, logger, run),
    close: () => connection.close(),
  };
}

class ImmediateResponseTransport implements CdpWebSocketTransport {
  readonly connected = true;
  private messageHandler?: (data: string) => void;

  send(payload: string): void {
    const { id } = JSON.parse(payload) as { id: number };
    this.messageHandler?.(JSON.stringify({ id, result: {} }));
  }

  async close(): Promise<void> {}

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(_handler: (event: CdpWebSocketCloseEvent) => void): void {}

  onError(_handler: (error: Error) => void): void {}
}
