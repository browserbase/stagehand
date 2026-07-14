import { ROOT_CONTEXT, TraceFlags, createTraceState, trace } from "@opentelemetry/api";
import { describe, expect, it } from "vite-plus/test";
import { getStagehandTraceContextFields } from "../../../modcdp/index.ts";

describe("Stagehand bridge trace context", () => {
  it("serializes active W3C trace context into JSON-RPC request fields", () => {
    const requestContext = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: TraceFlags.SAMPLED,
      traceState: createTraceState("vendor=value"),
    });

    expect(getStagehandTraceContextFields(requestContext)).toStrictEqual({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
  });

  it("leaves trace fields empty when the client has no active trace", () => {
    expect(getStagehandTraceContextFields(ROOT_CONTEXT)).toStrictEqual({});
  });
});
