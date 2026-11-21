import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagehandLog } from "@browserbasehq/stagehand-protocol/types";
import { StagehandLogger } from "../logger.js";
import { CdpConnection, CdpSession } from "./cdp.js";
import type { CdpWebSocketCloseEvent, CdpWebSocketTransport } from "./cdp.js";

type LogEntry = {
  logger: string;
  message: string;
};

afterEach(() => vi.restoreAllMocks());

describe("CdpConnection telemetry context", () => {
  it("uses the innermost logger for a request and its response", async () => {
    const entries: LogEntry[] = [];
    const transport = new TestTransport(true);
    const connection = new CdpConnection(transport, logger("session", entries));
    const scope = Symbol("request");

    await connection.runWithTelemetryContext(scope, logger("request", entries), () =>
      connection.runWithTelemetryContext(scope, logger("operation", entries), () =>
        connection.send("Runtime.evaluate"),
      ),
    );

    expect(entries).toStrictEqual([
      { logger: "operation", message: "CDP call" },
      { logger: "operation", message: "CDP response" },
    ]);
  });

  it("keeps the call logger when the response arrives after its scope closes", async () => {
    const entries: LogEntry[] = [];
    const transport = new TestTransport(false);
    const connection = new CdpConnection(transport, logger("session", entries));
    let response: Promise<unknown> | undefined;

    await connection.runWithTelemetryContext(Symbol("request"), logger("request", entries), () => {
      response = connection.send("Page.getFrameTree");
    });
    transport.respondToNextCall();
    await response;

    expect(entries).toStrictEqual([
      { logger: "request", message: "CDP call" },
      { logger: "request", message: "CDP response" },
    ]);
  });

  it("uses the neutral fallback instead of guessing between concurrent requests", async () => {
    const entries: LogEntry[] = [];
    const transport = new TestTransport(true);
    const connection = new CdpConnection(transport, logger("session", entries));
    let finishFirst: (() => void) | undefined;

    const first = connection.runWithTelemetryContext(
      Symbol("first"),
      logger("first", entries),
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    await Promise.resolve();
    await connection.runWithTelemetryContext(Symbol("second"), logger("second", entries), () =>
      connection.send("DOM.getDocument"),
    );
    finishFirst?.();
    await first;

    expect(entries).toStrictEqual([
      { logger: "session", message: "CDP call" },
      { logger: "session", message: "CDP response" },
    ]);
  });

  it.each(["root", "session"])(
    "serializes suppressed %s calls only for transport and observes level changes",
    async (scope) => {
      const logs: StagehandLog[] = [];
      const transport = new TestTransport(true);
      const telemetry = new StagehandLogger(
        { tracer: trace.getTracer("cdp-suppressed-call-test") },
        (log) => logs.push(log),
      );
      const connection = new CdpConnection(transport, telemetry);
      connection.sessionToTarget.set("session", "target");
      const sender = scope === "root" ? connection : new CdpSession(connection, "session");
      const toJSON = vi.fn(() => ({ expression: "42" }));
      const params = { toJSON };

      await expect(sender.send("Runtime.evaluate", params)).resolves.toEqual({});
      expect(toJSON).toHaveBeenCalledTimes(1);
      expect(logs).toEqual([]);
      expect(JSON.parse(transport.payloads[0]!)).toEqual({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression: "42" },
        ...(scope === "session" ? { sessionId: "session" } : {}),
      });

      telemetry.setLevel("debug");
      toJSON.mockClear();
      await sender.send("Runtime.evaluate", params);
      expect(toJSON).toHaveBeenCalledTimes(2);
      expect(logs).toEqual([
        {
          level: "debug",
          message: "CDP call",
          data: {
            requestId: 2,
            method: "Runtime.evaluate",
            sessionId: scope === "session" ? "session" : null,
            targetId: scope === "session" ? "target" : null,
            params: '{"expression":"42"}',
          },
        },
        {
          level: "debug",
          message: "CDP response",
          data: {
            requestId: 2,
            method: "Runtime.evaluate",
            targetId: scope === "session" ? "target" : null,
          },
        },
      ]);
      expect(connection.inflight.size).toBe(0);
    },
  );

  it("does not serialize suppressed event data or skip event dispatch", () => {
    const transport = new TestTransport(false);
    const telemetry = new StagehandLogger({ tracer: trace.getTracer("cdp-event-test") }, () => {});
    const connection = new CdpConnection(transport, telemetry);
    const session = new CdpSession(connection, "session");
    connection.sessions.set("session", session);
    const rootHandler = vi.fn();
    const sessionHandler = vi.fn();
    connection.on("Runtime.consoleAPICalled", rootHandler);
    session.on("Runtime.consoleAPICalled", sessionHandler);
    const params = { type: "log", args: [{ value: "hello" }] };
    const rootEvent = JSON.stringify({ method: "Runtime.consoleAPICalled", params });
    const sessionEvent = JSON.stringify({
      method: "Runtime.consoleAPICalled",
      params,
      sessionId: "session",
    });
    const stringify = vi.spyOn(JSON, "stringify");

    connection.onMessage(rootEvent);
    connection.onMessage(sessionEvent);

    // Schema compilation may stringify field names, but never the event payload.
    expect(stringify.mock.calls.filter(([value]) => typeof value === "object")).toEqual([]);
    expect(rootHandler).toHaveBeenCalledExactlyOnceWith(params);
    expect(sessionHandler).toHaveBeenCalledExactlyOnceWith(params);
  });

  it("keeps concrete debug payloads for custom loggers without a level query", async () => {
    const transport = new TestTransport(true);
    const debug = vi.fn();
    const connection = new CdpConnection(transport, { debug, error: vi.fn() });
    await connection.send("Runtime.evaluate", { expression: "42" });
    connection.onMessage('{"method":"Runtime.consoleAPICalled","params":{"type":"log"}}');

    expect(debug).toHaveBeenCalledWith(
      "CDP call",
      expect.objectContaining({ params: '{"expression":"42"}' }),
    );
    expect(debug).toHaveBeenCalledWith(
      "CDP message",
      expect.objectContaining({ params: '{"type":"log"}' }),
    );
  });

  it.each(["root", "session"])(
    "retains error reporting and rejection for %s calls with debug suppressed",
    async (scope) => {
      const logs: StagehandLog[] = [];
      const telemetry = new StagehandLogger({ tracer: trace.getTracer("cdp-error-test") }, (log) =>
        logs.push(log),
      );
      const transport = new TestTransport(false);
      const connection = new CdpConnection(transport, telemetry);
      const sender = scope === "root" ? connection : new CdpSession(connection, "session");
      const response = sender.send("Runtime.evaluate");
      transport.respondToNextCall({ error: { code: -32000, message: "evaluation failed" } });

      await expect(response).rejects.toThrow("-32000 evaluation failed");
      expect(logs).toEqual([
        expect.objectContaining({ level: "error", message: "CDP response failed" }),
      ]);
      expect(connection.inflight.size).toBe(0);
    },
  );

  it.each(["root", "session"])(
    "does not retain %s calls whose required transport serialization fails",
    async (scope) => {
      const telemetry = new StagehandLogger(
        { tracer: trace.getTracer("cdp-invalid-params-test") },
        () => {},
      );
      const transport = new TestTransport(false);
      const connection = new CdpConnection(transport, telemetry);
      const sender = scope === "root" ? connection : new CdpSession(connection, "session");
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const throwing = {
        toJSON() {
          throw new Error("Cannot serialize params");
        },
      };

      for (const params of [cyclic, { value: 1n }, throwing]) {
        await expect(async () => sender.send("Runtime.evaluate", params)).rejects.toThrow();
        expect(connection.inflight.size).toBe(0);
        expect(transport.payloads).toEqual([]);
      }
    },
  );
});

function logger(name: string, entries: LogEntry[]) {
  return {
    debug(message: string) {
      entries.push({ logger: name, message });
    },
    error(message: string) {
      entries.push({ logger: name, message });
    },
  };
}

class TestTransport implements CdpWebSocketTransport {
  readonly connected = true;
  readonly payloads: string[] = [];
  private messageHandler?: (data: string) => void;
  private readonly sent: string[] = [];

  constructor(private readonly autoRespond: boolean) {}

  send(payload: string): void {
    this.payloads.push(payload);
    this.sent.push(payload);
    if (this.autoRespond) this.respondToNextCall();
  }

  respondToNextCall(
    response: { result?: unknown; error?: { code: number; message: string } } = { result: {} },
  ): void {
    const payload = this.sent.shift();
    if (!payload) throw new Error("No pending CDP call");
    const { id } = JSON.parse(payload) as { id: number };
    this.messageHandler?.(JSON.stringify({ id, ...response }));
  }

  async close(): Promise<void> {}

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(_handler: (event: CdpWebSocketCloseEvent) => void): void {}

  onError(_handler: (error: Error) => void): void {}
}
