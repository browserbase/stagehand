import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { describe, expect, it } from "vite-plus/test";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.ts";
import { createStagehandRuntime } from "../runtime.ts";
import { RPCRouter } from "../rpcRouter.ts";
import { createStagehandTracingRuntime, type StagehandTracing } from "../tracing.ts";

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

    await router.handle(request({ id: 10, method: "ping", params: {} }));
    await tracing.forceFlush();

    expect(spans.getFinishedSpans()).toContainEqual(
      expect.objectContaining({
        name: "ping",
        kind: SpanKind.SERVER,
        attributes: expect.objectContaining({
          "rpc.system.name": "jsonrpc",
          "rpc.method": "ping",
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

    await router.handle(
      request({
        id: 11,
        method: "ping",
        params: {},
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
        tracestate: "vendor=value",
      }),
    );
    await tracing.forceFlush();

    const span = spans.getFinishedSpans().find((candidate) => candidate.name === "ping");
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

    const span = spans.getFinishedSpans().find((candidate) => candidate.name === "page.url");
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

  it("keeps emitted logs under the JSON-RPC request span", async () => {
    const spans = new InMemorySpanExporter();
    const tracing = configuredTracing(
      createStagehandTracingRuntime(
        { registerGlobals: false },
        { spanProcessors: [new SimpleSpanProcessor(spans)] },
      ),
    );
    const router = createRouter(tracing);

    await router.handle(request({ id: 14, method: "ping", params: {} }));
    await tracing.forceFlush();

    const requestSpan = spans.getFinishedSpans().find((span) => span.name === "ping");
    const logSpan = spans.getFinishedSpans().find((span) => span.name === "[stagehand] ping");
    expect(logSpan?.spanContext().traceId).toBe(requestSpan?.spanContext().traceId);
    expect(logSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
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
