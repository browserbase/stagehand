import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { afterEach, describe, expect, it } from "vitest";
import extensionPackageJson from "../package.json" with { type: "json" };
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
      extensionPackageJson.version,
    );
  });

  it("exports spans to the configured OTLP traces endpoint", async () => {
    const requests: Array<{ authorization?: string; method?: string; url?: string }> = [];
    const spans = new InMemorySpanExporter();
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
    const runtime = createStagehandTracing(
      { registerGlobals: false },
      { spanProcessors: [new SimpleSpanProcessor(spans)] },
    );
    await runtime.configure(
      {
        traces: {
          endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
          headers: { Authorization: "Bearer test" },
        },
      },
      { name: "stagehand-sdk-test", version: "4.0.0" },
    );
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
    expect(spans.getFinishedSpans()[0]?.resource.attributes).toMatchObject({
      "stagehand.client.name": "stagehand-sdk-test",
      "stagehand.client.version": "4.0.0",
    });
  });

  it("replaces the telemetry exporter and client metadata when reconfigured", async () => {
    const requests: Array<{ authorization?: string }> = [];
    const resources: Array<Record<string, unknown>> = [];
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requests.push({ authorization: request.headers.authorization });
        response.writeHead(200);
        response.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}/v1/traces`;
    const resourceProcessor: SpanProcessor = {
      forceFlush: async () => {},
      onEnd: (span) => resources.push({ ...span.resource.attributes }),
      onStart: () => {},
      shutdown: async () => {},
    };
    const runtime = createStagehandTracing(
      { registerGlobals: false },
      { spanProcessors: [resourceProcessor] },
    );
    runtimes.push(runtime);

    await runtime.configure(
      {
        traces: { endpoint, headers: { Authorization: "Bearer first" } },
      },
      { name: "stagehand-sdk-first", version: "4.0.0" },
    );
    runtime.tracer.startSpan("stagehand.test.first").end();

    await runtime.configure(
      {
        traces: { endpoint, headers: { Authorization: "Bearer second" } },
      },
      { name: "stagehand-sdk-second", version: "5.0.0" },
    );
    runtime.tracer.startSpan("stagehand.test.second").end();
    await runtime.forceFlush();
    await runtime.shutdown();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    expect(requests).toStrictEqual([
      { authorization: "Bearer first" },
      { authorization: "Bearer second" },
    ]);
    expect(resources).toHaveLength(2);
    expect(resources[0]).toMatchObject({
      "stagehand.client.name": "stagehand-sdk-first",
      "stagehand.client.version": "4.0.0",
    });
    expect(resources[1]).toMatchObject({
      "stagehand.client.name": "stagehand-sdk-second",
      "stagehand.client.version": "5.0.0",
    });
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
