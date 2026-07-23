import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { afterEach, describe, expect, it } from "vite-plus/test";
import serverPackageJson from "../package.json" with { type: "json" };
import { createStagehandTracing, createStagehandTracingRuntime } from "../tracing.ts";

const runtimes: Array<{ shutdown(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});

describe("Stagehand tracing", () => {
  it("fans out every finished span to every installed span processor", async () => {
    const firstExporter = new InMemorySpanExporter();
    const secondExporter = new InMemorySpanExporter();
    const runtime = createStagehandTracingRuntime(
      { registerGlobals: false },
      {
        spanProcessors: [
          new SimpleSpanProcessor(firstExporter),
          new SimpleSpanProcessor(secondExporter),
        ],
      },
    );
    runtimes.push(runtime);

    runtime.tracer.startSpan("stagehand.test.fan_out").end();
    await runtime.forceFlush();

    expect(firstExporter.getFinishedSpans().map((span) => span.name)).toStrictEqual([
      "stagehand.test.fan_out",
    ]);
    expect(secondExporter.getFinishedSpans().map((span) => span.name)).toStrictEqual([
      "stagehand.test.fan_out",
    ]);
    expect(firstExporter.getFinishedSpans()[0]?.resource.attributes[ATTR_SERVICE_VERSION]).toBe(
      serverPackageJson.version,
    );
  });

  it("exports spans to the configured OTLP traces endpoint", async () => {
    const requests: Array<{ authorization?: string; method?: string; url?: string }> = [];
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requests.push({
          authorization: request.headers.authorization,
          method: request.method,
          url: request.url,
        });
        response.writeHead(200);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const runtime = createStagehandTracing({ registerGlobals: false });
    runtime.configure({
      traces: {
        endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
        headers: { Authorization: "Bearer test" },
      },
    });
    runtimes.push(runtime);

    runtime.tracer.startSpan("stagehand.test.export").end();
    await runtime.forceFlush();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    expect(requests).toStrictEqual([
      {
        authorization: "Bearer test",
        method: "POST",
        url: "/v1/traces",
      },
    ]);
  });

  it("shuts down every processor exactly once", async () => {
    let shutdownCalls = 0;
    const processor: SpanProcessor = {
      forceFlush: async () => {},
      onEnd: () => {},
      onStart: () => {},
      shutdown: async () => {
        shutdownCalls += 1;
      },
    };
    const runtime = createStagehandTracingRuntime(
      { registerGlobals: false },
      { spanProcessors: [processor] },
    );
    runtimes.push(runtime);

    await runtime.shutdown();
    await runtime.shutdown();

    expect(shutdownCalls).toBe(1);
  });

  it("does not fail Stagehand shutdown when telemetry export fails", async () => {
    const processor: SpanProcessor = {
      forceFlush: async () => {},
      onEnd: () => {},
      onStart: () => {},
      shutdown: async () => {
        throw new Error("Collector unavailable");
      },
    };
    const runtime = createStagehandTracingRuntime(
      { registerGlobals: false },
      { spanProcessors: [processor] },
    );
    runtimes.push(runtime);

    await expect(runtime.shutdown()).resolves.toBeUndefined();
  });
});
