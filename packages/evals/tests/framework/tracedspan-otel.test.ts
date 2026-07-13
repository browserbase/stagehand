import { SpanStatusCode } from "@opentelemetry/api";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const span = {
    setAttribute: vi.fn(),
    addEvent: vi.fn(),
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn(),
  };
  const startActiveSpan = vi.fn(
    async (_name: string, callback: (activeSpan: typeof span) => unknown) =>
      callback(span),
  );
  const getTracer = vi.fn(() => ({ startActiveSpan }));

  return { getTracer, span, startActiveSpan };
});

vi.mock("../../framework/otel.js", () => ({
  getTracer: mocks.getTracer,
}));

const originalEnv = { ...process.env };

describe("tracedSpan OTEL transport", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BRAINTRUST_API_KEY;
    delete process.env.EVAL_TRACE_TRANSPORT;
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("maps logged fields to OTEL attributes and events", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    const { tracedSpan } = await import("../../framework/braintrust.js");
    const callback = vi.fn(async (span) => {
      span.log({
        output: { answer: "done" },
        scores: { accuracy: 1 },
        metrics: { duration_ms: 25 },
        metadata: { task: "example" },
      });
      return "result";
    });

    await expect(tracedSpan(callback, { name: "test-span" })).resolves.toBe(
      "result",
    );

    expect(callback).toHaveBeenCalledOnce();
    expect(mocks.startActiveSpan).toHaveBeenCalledWith(
      "test-span",
      expect.any(Function),
    );
    expect(mocks.span.setAttribute).toHaveBeenCalledWith(
      "metadata.task",
      "example",
    );
    expect(mocks.span.setAttribute).toHaveBeenCalledWith(
      "metrics.duration_ms",
      25,
    );
    expect(mocks.span.addEvent).toHaveBeenCalledWith("scores", {
      "scores.accuracy": 1,
    });
    expect(mocks.span.addEvent).toHaveBeenCalledWith("output", {
      answer: "done",
    });
    expect(mocks.span.end).toHaveBeenCalledOnce();
  });

  it("records a throwing callback and still ends the span", async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    const { tracedSpan } = await import("../../framework/braintrust.js");
    const error = new Error("callback failed");

    await expect(
      tracedSpan(
        async () => {
          throw error;
        },
        { name: "failing-span" },
      ),
    ).rejects.toBe(error);

    expect(mocks.span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: "callback failed",
    });
    expect(mocks.span.recordException).toHaveBeenCalledWith(error);
    expect(mocks.span.end).toHaveBeenCalledOnce();
  });

  it("uses the no-op span in native mode", async () => {
    const { tracedSpan } = await import("../../framework/braintrust.js");
    const callback = vi.fn(async (span) => {
      span.log({ output: "ignored" });
      return 42;
    });

    await expect(tracedSpan(callback, { name: "native-span" })).resolves.toBe(
      42,
    );
    expect(callback).toHaveBeenCalledOnce();
    expect(mocks.getTracer).not.toHaveBeenCalled();
    expect(mocks.startActiveSpan).not.toHaveBeenCalled();
  });
});
