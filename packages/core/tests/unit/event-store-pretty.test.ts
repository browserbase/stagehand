import { afterEach, describe, expect, it, vi } from "vitest";
import { PrettyStderrEventSink } from "../../lib/v3/eventStore.js";
import { FlowEvent } from "../../lib/v3/flowLogger.js";

describe("PrettyStderrEventSink", () => {
  const stderrWrite = process.stderr.write.bind(process.stderr);

  afterEach(() => {
    process.stderr.write = stderrWrite;
  });

  it("preserves indentation derived from parent depth", async () => {
    const sink = new PrettyStderrEventSink();
    const writes: string[] = [];

    process.stderr.write = ((chunk: string, cb?: (error?: Error | null) => void) => {
      writes.push(String(chunk));
      cb?.(null);
      return true;
    }) as typeof process.stderr.write;

    await sink.emit(
      new FlowEvent({
        eventType: "NestedEvent",
        sessionId: "session-test",
        eventId: "event-1234",
        eventParentIds: ["parent-1", "parent-2"],
        createdAt: "2026-03-16T21:45:00.000Z",
        data: { msg: "hello" },
      }),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("    [#1234] NestedEvent");
  });
});
