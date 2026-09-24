import { EventEmitter } from "node:events";

import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";

import { NetworkCdpSidecar } from "../src/lib/driver/network-cdp-sidecar.js";

describe("NetworkCdpSidecar", () => {
  it("reuses one browser WebSocket across detached page sessions", async () => {
    const socket = new FakeWebSocket();
    const factory = vi.fn(() => {
      queueMicrotask(() => socket.open());
      return socket as unknown as WebSocket;
    });
    const sidecar = new NetworkCdpSidecar(factory);

    const first = await sidecar.attach("ws://browser.test", "page-1");
    const listener = vi.fn();
    first.on("Network.requestWillBeSent", listener);
    socket.emitCdp({
      method: "Network.requestWillBeSent",
      params: { requestId: "request-1" },
      sessionId: "sidecar-session-1",
    });

    expect(listener).toHaveBeenCalledWith({ requestId: "request-1" });
    await expect(first.send("Network.enable")).resolves.toEqual({});
    await first.detach();
    expect(first.connected).toBe(false);

    const second = await sidecar.attach("ws://browser.test", "page-2");
    expect(second.connected).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
    expect(socket.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "Target.attachToTarget",
          params: { flatten: true, targetId: "page-1" },
        }),
        expect.objectContaining({
          method: "Target.detachFromTarget",
          params: { sessionId: "sidecar-session-1" },
        }),
        expect.objectContaining({
          method: "Target.attachToTarget",
          params: { flatten: true, targetId: "page-2" },
        }),
      ]),
    );

    sidecar.close();
    expect(socket.closed).toBe(true);
  });
});

class FakeWebSocket extends EventEmitter {
  closed = false;
  readyState = 0;
  readonly sent: Array<{
    id: number;
    method: string;
    params: Record<string, unknown>;
    sessionId?: string;
  }> = [];
  private sessionCounter = 0;

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  send(raw: string): void {
    const message = JSON.parse(raw) as (typeof this.sent)[number];
    this.sent.push(message);
    const result =
      message.method === "Target.attachToTarget"
        ? { sessionId: `sidecar-session-${++this.sessionCounter}` }
        : {};
    queueMicrotask(() => this.emitCdp({ id: message.id, result }));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.emit("close");
  }

  emitCdp(message: Record<string, unknown>): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
}
