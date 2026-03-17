import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import { CdpConnection } from "../../lib/v3/understudy/cdp.js";
import { EventStore, InMemoryEventSink } from "../../lib/v3/eventStore.js";
import { FlowLogger, type FlowEvent } from "../../lib/v3/flowLogger.js";

class FakeSocket extends EventEmitter {
  sentPayloads: string[] = [];
  readyState = 1;

  send(payload: string): void {
    this.sentPayloads.push(payload);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", 1000, "");
  }
}

function createConnection(socket: FakeSocket): CdpConnection {
  // The production constructor is private; tests instantiate it directly so
  // they can drive raw websocket messages without a real browser.
  const ConnectionCtor = CdpConnection as unknown as {
    new (ws: FakeSocket): CdpConnection;
  };
  return new ConnectionCtor(socket);
}

function requireEvent(
  events: FlowEvent[],
  predicate: (event: FlowEvent) => boolean,
  description: string,
): FlowEvent {
  const match = events.find(predicate);
  expect(match, `missing ${description}`).toBeDefined();
  return match as FlowEvent;
}

describe("CdpConnection flow logging context", () => {
  it("preserves the active parent chain when a session event handler issues a nested CDP call", async () => {
    const sessionId = "session-test";
    const socket = new FakeSocket();
    const eventBus = new EventEmitter();
    const eventStore = new EventStore(sessionId);
    const sink = new InMemoryEventSink();

    eventStore.attachStore(sink);
    const detachBus = eventStore.attachBus(eventBus);

    const conn = createConnection(socket);
    conn.flowLoggerContext = FlowLogger.init(sessionId, eventBus);

    // Seed the target/session mapping the same way a real attach flow would
    // before any session-scoped messages are dispatched.
    (conn as unknown as { onMessage(json: string): void }).onMessage(
      JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "target-session",
          targetInfo: { targetId: "target-1" },
        },
      }),
    );

    const session = conn.getSession("target-session");
    expect(session).toBeDefined();

    session!.on("Runtime.consoleAPICalled", () => {
      // This nested send used to lose its parent chain because the callback ran
      // after the original ALS scope had already unwound.
      void session!.send("Runtime.evaluate", {
        expression: "2 + 2",
      });
    });

    await FlowLogger.runWithLogging(
      {
        context: conn.flowLoggerContext,
        eventType: "SyntheticParentEvent",
      },
      async () => {
        void session!.send("Page.navigate", {
          url: "https://example.com",
        });
      },
      [],
    );

    (conn as unknown as { onMessage(json: string): void }).onMessage(
      JSON.stringify({
        method: "Runtime.consoleAPICalled",
        sessionId: "target-session",
        params: { type: "log" },
      }),
    );

    // The nested Runtime.evaluate call should still attach under the synthetic
    // parent event even though it was triggered by a later session callback.
    const events = await eventStore.query({});
    const parentEvent = requireEvent(
      events,
      (event) => event.eventType === "SyntheticParentEvent",
      "SyntheticParentEvent",
    );
    const nestedCallEvent = requireEvent(
      events,
      (event) =>
        event.eventType === "CdpCallEvent" &&
        String(event.data.method) === "Runtime.evaluate",
      "nested Runtime.evaluate CdpCallEvent",
    );

    expect(nestedCallEvent.eventParentIds).toEqual([parentEvent.eventId]);

    detachBus();
    await eventStore.destroy();
  });
});
