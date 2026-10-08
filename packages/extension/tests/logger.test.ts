import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";

describe("StagehandLogger thresholds", () => {
  it("skips validation, serialization and tracing for suppressed logs", () => {
    const tracer = trace.getTracer("logger-threshold-test");
    const startSpan = vi.spyOn(tracer, "startSpan");
    const emit = vi.fn();
    const logger = new StagehandLogger({ tracer }, emit);
    const data = {
      get value(): string {
        throw new Error("Suppressed log data must not be read");
      },
    };

    expect(() => logger.debug("", data)).not.toThrow();
    logger.setLevel("off");
    expect(() => logger.error("", data)).not.toThrow();
    expect(startSpan).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    startSpan.mockRestore();
  });

  it("applies level changes and validates logs that will be emitted", () => {
    const emit = vi.fn();
    const logger = new StagehandLogger({ tracer: trace.getTracer("logger-enabled-test") }, emit);

    expect(logger.isEnabled("debug")).toBe(false);
    expect(logger.isEnabled("error")).toBe(true);
    logger.setLevel("debug");
    expect(logger.isEnabled("debug")).toBe(true);
    expect(() => logger.debug("", {})).toThrow();
    logger.debug("visible", { value: 1 });
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      level: "debug",
      message: "visible",
      data: { value: 1 },
    });
  });
});
