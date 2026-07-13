import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { browserLoopbackCdpFactory } from "../../../server/transports/browserLoopbackCdpConnection.js";
import { browserWebSocketFactory } from "../../../server/understudy/browserWebSocketTransport.js";
import { CdpConnection } from "../../../server/understudy/cdp.js";

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.dispatchEvent(new Event("open"));
    });
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(Object.assign(new Event("close"), { code: 1000, reason: "" }));
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

class DelayedBlob extends Blob {
  constructor(
    parts: BlobPart[],
    private readonly delayMs: number,
  ) {
    super(parts);
  }

  override async text(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return await super.text();
  }
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("Expected a websocket instance");
  return socket;
}

function requestId(socket: FakeWebSocket, index: number): number {
  const payload = JSON.parse(socket.sent[index] ?? "") as { id?: unknown };
  if (typeof payload.id !== "number") throw new Error("Expected a numeric CDP request id");
  return payload.id;
}

describe("CdpConnection browser WebSocket transport", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes browser message types without reordering CDP responses", async () => {
    const connection = await CdpConnection.connect("ws://cdp.test", browserWebSocketFactory);
    const socket = latestSocket();
    const completionOrder: string[] = [];

    const first = connection.send<string>("Runtime.evaluate").then((result) => {
      completionOrder.push(result);
      return result;
    });
    const second = connection.send<string>("Runtime.evaluate").then((result) => {
      completionOrder.push(result);
      return result;
    });

    socket.receive(
      new DelayedBlob([JSON.stringify({ id: requestId(socket, 0), result: "first" })], 10),
    );
    socket.receive(
      new TextEncoder().encode(JSON.stringify({ id: requestId(socket, 1), result: "second" })),
    );

    await expect(Promise.all([first, second])).resolves.toStrictEqual(["first", "second"]);
    expect(completionOrder).toStrictEqual(["first", "second"]);

    const third = connection.send<string>("Runtime.evaluate");
    const thirdPayload = new TextEncoder().encode(
      JSON.stringify({ id: requestId(socket, 2), result: "third" }),
    );
    socket.receive(thirdPayload.buffer.slice(0));
    await expect(third).resolves.toBe("third");

    const fourth = connection.send<string>("Runtime.evaluate");
    socket.receive(JSON.stringify({ id: requestId(socket, 3), result: "fourth" }));
    await expect(fourth).resolves.toBe("fourth");
  });

  it("preserves response order in the loopback CDP transport", async () => {
    const connection = await browserLoopbackCdpFactory("ws://loopback.test");
    const socket = latestSocket();
    const completionOrder: string[] = [];

    const first = connection.send<string>("Browser.getVersion").then((result) => {
      completionOrder.push(result);
      return result;
    });
    const second = connection.send<string>("Browser.getVersion").then((result) => {
      completionOrder.push(result);
      return result;
    });

    socket.receive(
      new DelayedBlob([JSON.stringify({ id: requestId(socket, 0), result: "first" })], 10),
    );
    socket.receive(
      new TextEncoder().encode(JSON.stringify({ id: requestId(socket, 1), result: "second" })),
    );

    await expect(Promise.all([first, second])).resolves.toStrictEqual(["first", "second"]);
    expect(completionOrder).toStrictEqual(["first", "second"]);
  });

  it("rejects pending work when an incoming CDP envelope is invalid", async () => {
    const connection = await CdpConnection.connect("ws://cdp.test", browserWebSocketFactory);
    const socket = latestSocket();
    const pending = connection.send("Runtime.evaluate");

    socket.receive(JSON.stringify({ id: "not-a-number", result: {} }));

    await expect(pending).rejects.toThrow("socket-message-error");
  });
});
