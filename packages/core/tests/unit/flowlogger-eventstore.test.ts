import { afterEach, describe, expect, it } from "vitest";
import { EventStore } from "../../lib/v3/flowlogger/EventStore.js";
import { EventEmitterWithWildcardSupport } from "../../lib/v3/flowlogger/EventEmitter.js";
import { FlowEvent } from "../../lib/v3/flowlogger/FlowLogger.js";

function attachEventStoreToBus(
  store: EventStore,
  bus: EventEmitterWithWildcardSupport,
): () => void {
  const onFlowEvent = (event: unknown) => {
    if (event instanceof FlowEvent) {
      void store.emit(event);
    }
  };

  bus.on("*", onFlowEvent);
  return () => {
    bus.off("*", onFlowEvent);
  };
}

function createVerboseStoreHarness(): {
  writes: string[];
  store: EventStore;
  bus: EventEmitterWithWildcardSupport;
  detachBus: () => void;
} {
  const writes: string[] = [];
  process.stderr.write = ((
    chunk: string,
    cb?: (error?: Error | null) => void,
  ) => {
    writes.push(String(chunk));
    cb?.(null);
    return true;
  }) as typeof process.stderr.write;

  const store = new EventStore("session-test");
  const bus = new EventEmitterWithWildcardSupport();
  const detachBus = attachEventStoreToBus(store, bus);

  return { writes, store, bus, detachBus };
}

describe("flow logger event store", () => {
  const stderrWrite = process.stderr.write.bind(process.stderr);

  afterEach(() => {
    process.stderr.write = stderrWrite;
  });

  it("queries recent events from the default in-memory sink", async () => {
    const store = new EventStore("session-test");

    await store.emit(
      new FlowEvent({
        eventType: "StagehandExtractEvent",
        sessionId: "session-test",
        eventId: "stagehand-1234",
        eventCreatedAt: "2026-03-16T21:45:00.000Z",
        data: { params: ["grab title"] },
      }),
    );

    const events = await store.query({});
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("StagehandExtractEvent");

    await store.destroy();
  });

  it("drops payloads from the default in-memory sink", async () => {
    const store = new EventStore("session-test");

    await store.emit(
      new FlowEvent({
        eventType: "LlmRequestEvent",
        sessionId: "session-test",
        eventId: "llm-1234",
        eventCreatedAt: "2026-03-16T21:45:00.000Z",
        data: {
          prompt: [{ type: "image_url", image_url: { url: "huge" } }],
          output: "huge",
        },
      }),
    );

    const [event] = await store.query({});
    expect(event.eventType).toBe("LlmRequestEvent");
    expect(event.eventId).toBe("llm-1234");
    expect(event.data).toEqual({});

    await store.destroy();
  });

  it("renders semantic hierarchy tags for non-cdp stderr events only", async () => {
    // Intercept stderr so the pretty sink can be asserted without polluting the
    // real test runner output.
    const { writes, store, bus, detachBus } = createVerboseStoreHarness();

    const stepEvent = new FlowEvent({
      eventType: "StagehandExtractEvent",
      sessionId: "session-test",
      eventId: "stagehand-1234",
      eventCreatedAt: "2026-03-16T21:45:00.000Z",
      data: { params: ["grab title"] },
    });
    const cdpEvent = new FlowEvent({
      eventType: "CdpCallEvent",
      sessionId: "session-test",
      eventId: "cdp-call-5678",
      eventCreatedAt: "2026-03-16T21:45:00.100Z",
      eventParentIds: [stepEvent.eventId],
      data: {
        method: "Runtime.evaluate",
        params: { expression: "2 + 2" },
        targetId: "1234567890ABCDEF1234567890ABCDEF",
      },
    });

    // The stderr sink intentionally suppresses CDP noise even though the event
    // still exists for in-memory and file-backed sinks.
    bus.emit(stepEvent.eventType, stepEvent);
    bus.emit(cdpEvent.eventType, cdpEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("[🆂 #1234 EXTRACT]");
    expect(writes[0]).toContain("Stagehand.extract");
    expect(writes[0]).not.toContain("Runtime.evaluate");

    detachBus();
    await store.destroy();
  });

  it("renders generic stagehand events without crashing the stderr sink", async () => {
    const { writes, store, bus, detachBus } = createVerboseStoreHarness();

    // `StagehandEvent` has no action suffix, so this guards the formatter path
    // that cannot assume a method name exists.
    bus.emit(
      "StagehandEvent",
      new FlowEvent({
        eventType: "StagehandEvent",
        sessionId: "session-test",
        eventId: "stagehand-0001",
        eventCreatedAt: "2026-03-16T21:45:00.000Z",
        data: { params: ["noop"] },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("[🆂 #0001");
    expect(writes[0]).toContain("Stagehand(");

    detachBus();
    await store.destroy();
  });

  it("colorizes pretty stderr output with ansi escapes when enabled", async () => {
    const previousForceColor = process.env.FORCE_COLOR;
    const previousNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";

    const { writes, store, bus, detachBus } = createVerboseStoreHarness();

    try {
      bus.emit(
        "StagehandActEvent",
        new FlowEvent({
          eventType: "StagehandActEvent",
          sessionId: "session-test",
          eventId: "stagehand-0002",
          eventCreatedAt: "2026-03-16T21:45:00.000Z",
          data: { params: ["click submit"] },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("\u001B[");
    } finally {
      if (previousNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = previousNoColor;
      }

      if (previousForceColor === undefined) {
        delete process.env.FORCE_COLOR;
      } else {
        process.env.FORCE_COLOR = previousForceColor;
      }

      detachBus();
      await store.destroy();
    }
  });

  it("keeps agent ancestry and start ids for completion events after many child events", async () => {
    const { writes, store, bus, detachBus } = createVerboseStoreHarness();

    const agentEvent = new FlowEvent({
      eventType: "AgentExecuteEvent",
      sessionId: "session-test",
      eventId: "agent-1234",
      eventCreatedAt: "2026-03-16T21:45:00.000Z",
      data: { params: [{ instruction: "click the button" }] },
    });
    const actEvent = new FlowEvent({
      eventType: "StagehandActEvent",
      sessionId: "session-test",
      eventId: "stagehand-2222",
      eventCreatedAt: "2026-03-16T21:45:00.001Z",
      eventParentIds: [agentEvent.eventId],
      data: { params: ["click the button"] },
    });
    const clickEvent = new FlowEvent({
      eventType: "UnderstudyClickEvent",
      sessionId: "session-test",
      eventId: "action-3333",
      eventCreatedAt: "2026-03-16T21:45:00.002Z",
      eventParentIds: [agentEvent.eventId, actEvent.eventId],
      data: { target: "xpath=/button[1]" },
    });

    bus.emit(agentEvent.eventType, agentEvent);
    bus.emit(actEvent.eventType, actEvent);
    bus.emit(clickEvent.eventType, clickEvent);

    // Flood the retained history with child events so the completion lines have
    // to recover their displayed ancestry from the queryable sink.
    for (let index = 0; index < 150; index += 1) {
      bus.emit(
        "CdpCallEvent",
        new FlowEvent({
          eventType: "CdpCallEvent",
          sessionId: "session-test",
          eventId: `cdp-${String(index).padStart(4, "0")}`,
          eventCreatedAt: `2026-03-16T21:45:00.${String(index + 10).padStart(3, "0")}Z`,
          eventParentIds: [
            agentEvent.eventId,
            actEvent.eventId,
            clickEvent.eventId,
          ],
          data: {
            method: "Runtime.evaluate",
            params: { expression: `${index}` },
            targetId: "1234567890ABCDEF1234567890ABCDEF",
          },
        }),
      );
    }

    bus.emit(
      "UnderstudyClickCompletedEvent",
      new FlowEvent({
        eventType: "UnderstudyClickCompletedEvent",
        sessionId: "session-test",
        eventId: "done-4444",
        eventCreatedAt: "2026-03-16T21:45:01.000Z",
        eventParentIds: [
          agentEvent.eventId,
          actEvent.eventId,
          clickEvent.eventId,
        ],
        data: { durationMs: 250 },
      }),
    );
    bus.emit(
      "StagehandActCompletedEvent",
      new FlowEvent({
        eventType: "StagehandActCompletedEvent",
        sessionId: "session-test",
        eventId: "done-5555",
        eventCreatedAt: "2026-03-16T21:45:01.001Z",
        eventParentIds: [agentEvent.eventId, actEvent.eventId],
        data: { durationMs: 500 },
      }),
    );
    bus.emit(
      "AgentExecuteCompletedEvent",
      new FlowEvent({
        eventType: "AgentExecuteCompletedEvent",
        sessionId: "session-test",
        eventId: "done-6666",
        eventCreatedAt: "2026-03-16T21:45:01.002Z",
        eventParentIds: [agentEvent.eventId],
        data: { durationMs: 750 },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Completion lines should reference the original started-event ids, not the
    // synthetic completed-event ids emitted at the end of the lifecycle.
    const clickCompletedLine = writes.find((line) =>
      line.includes("CLICK completed"),
    );
    const actCompletedLine = writes.find((line) =>
      line.includes("ACT completed"),
    );
    const agentCompletedLine = writes.find((line) =>
      line.includes("Agent.execute() completed"),
    );

    expect(clickCompletedLine).toContain("[🅰 #1234]");
    expect(clickCompletedLine).toContain("[🆂 #2222 ACT]");
    expect(clickCompletedLine).toContain("[🆄 #3333 CLICK]");
    expect(clickCompletedLine).not.toContain("#4444");

    expect(actCompletedLine).toContain("[🅰 #1234]");
    expect(actCompletedLine).toContain("[🆂 #2222 ACT]");
    expect(actCompletedLine).not.toContain("#5555");

    expect(agentCompletedLine).toContain("[🅰 #1234]");
    expect(agentCompletedLine).not.toContain("#6666");

    detachBus();
    await store.destroy();
  });
});
