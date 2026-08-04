import { describe, expect, it } from "vitest";
import { CdpConnection } from "./cdp.js";
import type { CdpWebSocketCloseEvent, CdpWebSocketTransport } from "./cdp.js";

type LogEntry = {
  logger: string;
  message: string;
};

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

  it("uses the session logger instead of guessing between concurrent requests", async () => {
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
  private messageHandler?: (data: string) => void;
  private readonly sent: string[] = [];

  constructor(private readonly autoRespond: boolean) {}

  send(payload: string): void {
    this.sent.push(payload);
    if (this.autoRespond) this.respondToNextCall();
  }

  respondToNextCall(): void {
    const payload = this.sent.shift();
    if (!payload) throw new Error("No pending CDP call");
    const { id } = JSON.parse(payload) as { id: number };
    this.messageHandler?.(JSON.stringify({ id, result: {} }));
  }

  async close(): Promise<void> {}

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(_handler: (event: CdpWebSocketCloseEvent) => void): void {}

  onError(_handler: (error: Error) => void): void {}
}
