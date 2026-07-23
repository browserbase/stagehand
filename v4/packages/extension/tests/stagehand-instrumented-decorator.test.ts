import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Instrumented } from "../instrumentedDecorator.js";
import { StagehandLogger } from "../logger.js";
import { createStagehandTracingRuntime } from "../tracing.js";

const runtimes: Array<{ shutdown(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.allSettled(runtimes.splice(0).map((runtime) => runtime.shutdown()));
});

describe("Stagehand instrumented decorator", () => {
  it("uses the method name for a decorated async method", async () => {
    const { exporter, logger, tracing } = createTestTelemetry();

    class ExampleService {
      @Instrumented()
      async run(prefix: string, count: number, context: { logger: StagehandLogger }) {
        await Promise.resolve();
        context.logger.info("Example finished", { prefix, count });
        return `${prefix}:${count}`;
      }
    }

    await expect(new ExampleService().run("item", 3, { logger })).resolves.toBe("item:3");
    await tracing.forceFlush();

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(
      expect.arrayContaining(["run", "Example finished"]),
    );
  });

  it("records a rejected decorated method as a failed span and rethrows the error", async () => {
    const { exporter, logger, tracing } = createTestTelemetry();
    const failure = new Error("Example failed");

    class ExampleService {
      @Instrumented("example.fail")
      async fail(_context: { logger: StagehandLogger }): Promise<never> {
        await Promise.resolve();
        throw failure;
      }
    }

    await expect(new ExampleService().fail({ logger })).rejects.toBe(failure);
    await tracing.forceFlush();

    const span = exporter.getFinishedSpans().find((candidate) => candidate.name === "example.fail");
    expect(span?.status).toMatchObject({
      code: SpanStatusCode.ERROR,
      message: "Example failed",
    });
    expect(span?.events).toContainEqual(expect.objectContaining({ name: "exception" }));
  });

  it("keeps logs written after an await beneath the decorated method span", async () => {
    const { exporter, logger, tracing } = createTestTelemetry();

    class ExampleService {
      @Instrumented("example.await")
      async run(context: { logger: StagehandLogger }): Promise<void> {
        await Promise.resolve();
        context.logger.info("After await", {});
      }
    }

    await new ExampleService().run({ logger });
    await tracing.forceFlush();

    const spans = exporter.getFinishedSpans();
    const operationSpan = spans.find((span) => span.name === "example.await");
    const logSpan = spans.find((span) => span.name === "After await");
    expect(logSpan?.parentSpanContext?.spanId).toBe(operationSpan?.spanContext().spanId);
  });

  it("keeps nested decorated methods beneath their caller span", async () => {
    const { exporter, logger, tracing } = createTestTelemetry();

    class ExampleService {
      @Instrumented("example.outer")
      async outer(context: { logger: StagehandLogger }): Promise<void> {
        await Promise.resolve();
        await this.inner(context);
      }

      @Instrumented("example.inner")
      async inner(_context: { logger: StagehandLogger }): Promise<void> {
        await Promise.resolve();
      }
    }

    await new ExampleService().outer({ logger });
    await tracing.forceFlush();

    const spans = exporter.getFinishedSpans();
    const outerSpan = spans.find((span) => span.name === "example.outer");
    const innerSpan = spans.find((span) => span.name === "example.inner");
    expect(innerSpan?.parentSpanContext?.spanId).toBe(outerSpan?.spanContext().spanId);
  });
});

function createTestTelemetry() {
  const exporter = new InMemorySpanExporter();
  const tracing = createStagehandTracingRuntime(
    { registerGlobals: false },
    { spanProcessors: [new SimpleSpanProcessor(exporter)] },
  );
  const logger = new StagehandLogger(tracing, () => {});
  runtimes.push(tracing);
  return { exporter, logger, tracing };
}
