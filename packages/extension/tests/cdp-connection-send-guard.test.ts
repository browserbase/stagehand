import { afterEach, describe, expect, it, vi } from "vitest";
import { browserWebSocketFactory } from "../understudy/browserWebSocketTransport.js";
import { CdpConnection } from "../understudy/cdp.js";
import type { CdpWebSocketCloseEvent, CdpWebSocketTransport } from "../understudy/cdp.js";

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CdpConnection send guards", () => {
  it("rejects root sends immediately after the transport drops", async () => {
    const transport = new TestTransport();
    const connection = new CdpConnection(transport, logger);

    await expect(connection.send("Browser.getVersion")).resolves.toStrictEqual({});
    transport.drop();

    await expect(connection.send("Browser.getVersion")).rejects.toThrow(/closed/);
    expect(connection.inflight.size).toBe(0);
  });

  it("rejects session sends immediately after the transport drops", async () => {
    const transport = new TestTransport();
    const connection = new CdpConnection(transport, logger);
    transport.drop();

    await expect(connection._sendViaSession("sess", "Page.enable")).rejects.toThrow(/closed/);
    expect(connection.inflight.size).toBe(0);
  });

  it("settles a pre-resume dispatch waiter with the outcome of the guarded send", async () => {
    const transport = new TestTransport();
    const connection = new CdpConnection(transport, logger);

    const dispatchedWhileOpen = connection.waitForSessionDispatch("sess", "Page.enable");
    void connection._sendViaSession("sess", "Page.enable");
    await expect(dispatchedWhileOpen).resolves.toBeUndefined();

    transport.drop();
    const dispatchedAfterDrop = connection.waitForSessionDispatch("sess", "Page.enable");
    await expect(connection._sendViaSession("sess", "Page.enable")).rejects.toThrow(/closed/);
    await expect(dispatchedAfterDrop).rejects.toThrow(/closed/);

    transport.connected = true;
    transport.throwOnSend = true;
    const dispatchedOnThrow = connection.waitForSessionDispatch("sess", "Page.enable");
    await expect(connection._sendViaSession("sess", "Page.enable")).rejects.toThrow("send failed");
    await expect(dispatchedOnThrow).rejects.toThrow("send failed");
    expect(connection.sessionDispatchWaiters.size).toBe(0);
  });

  it("turns synchronous transport throws into rejected promises", async () => {
    const transport = new TestTransport();
    transport.throwOnSend = true;
    const connection = new CdpConnection(transport, logger);

    const rootSend = connection.send("Browser.getVersion");
    const sessionSend = connection._sendViaSession("sess", "Page.enable");

    await expect(rootSend).rejects.toThrow("send failed");
    await expect(sessionSend).rejects.toThrow("send failed");
    expect(connection.inflight.size).toBe(0);
  });
});

describe("BrowserWebSocketTransport send guard", () => {
  it("forwards on an open socket and rejects a closed socket", async () => {
    let socket: FakeWebSocket | undefined;
    class CapturedWebSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        socket = this;
      }
    }
    vi.stubGlobal("WebSocket", CapturedWebSocket);
    const transport = await browserWebSocketFactory("ws://127.0.0.1/devtools/browser/test");

    transport.send("open");
    expect(socket?.send).toHaveBeenCalledWith("open");
    socket!.readyState = FakeWebSocket.CLOSED;

    expect(() => transport.send("closed")).toThrow(/not open/);
    expect(socket?.send).toHaveBeenCalledOnce();
  });
});

class TestTransport implements CdpWebSocketTransport {
  connected = true;
  throwOnSend = false;
  private messageHandler?: (data: string) => void;
  private closeHandler?: (event: CdpWebSocketCloseEvent) => void;

  send(payload: string): void {
    if (this.throwOnSend) throw new Error("send failed");
    const { id } = JSON.parse(payload) as { id: number };
    this.messageHandler?.(JSON.stringify({ id, result: {} }));
  }

  drop(): void {
    this.connected = false;
    this.closeHandler?.({ code: 1006, reason: "dropped" });
  }

  async close(): Promise<void> {}

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (event: CdpWebSocketCloseEvent) => void): void {
    this.closeHandler = handler;
  }

  onError(_handler: (error: Error) => void): void {}
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = "blob";
  readonly send = vi.fn();

  constructor(readonly url: string) {
    super();
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}
