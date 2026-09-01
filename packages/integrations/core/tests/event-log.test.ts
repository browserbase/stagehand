import { describe, expect, it } from "vitest";
import {
  harnessEventLogLevel,
  isLifecycleBoundaryEventType,
  isStreamDeltaEventType,
} from "../src/harness/eventLog.js";

describe("harness event log levels", () => {
  it("recognizes stream fragments across SDK vocabularies", () => {
    for (const type of [
      "text-delta",
      "reasoning-delta",
      "tool-call-delta",
      "message_update",
      "tool_execution_update",
      "item.updated",
      "message.delta",
      "stream_event",
      "content_block_delta",
    ]) {
      expect(isStreamDeltaEventType(type), type).toBe(true);
    }
    expect(isStreamDeltaEventType("tool-call")).toBe(false);
    expect(isStreamDeltaEventType("message_end")).toBe(false);
  });

  it("recognizes lifecycle boundaries", () => {
    for (const type of ["reasoning-start", "turn.started", "message_end", "step-start"]) {
      expect(isLifecycleBoundaryEventType(type), type).toBe(true);
    }
    expect(isLifecycleBoundaryEventType("step-finish")).toBe(false);
    expect(isLifecycleBoundaryEventType("turn.completed")).toBe(false);
  });

  it("drops noise, demotes the rest, and keeps errors at level 1", () => {
    expect(harnessEventLogLevel("text-delta")).toBeUndefined();
    expect(harnessEventLogLevel("reasoning-start")).toBeUndefined();
    expect(harnessEventLogLevel("message_end", { hasContent: true })).toBe(2);
    expect(harnessEventLogLevel("tool-call")).toBe(2);
    expect(harnessEventLogLevel("text-delta", { isError: true })).toBe(1);
    expect(harnessEventLogLevel("turn.failed", { isError: true })).toBe(1);
  });
});
