import { describe, expect, it, vi } from "vitest";
import { CDPClient, openCDPWebSocket } from "../src/cdpClient.js";

class FakeWebSocket extends EventTarget {
  readyState = 0;
  send = vi.fn();
  close = vi.fn();

  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  fail(error: Error): void {
    const event = new Event("error");
    Object.defineProperty(event, "error", { value: error });
    this.dispatchEvent(event);
  }
}

describe("CDP WebSocket transport", () => {
  it("opens the built-in WebSocket transport", async () => {
    const socket = new FakeWebSocket();
    const createSocket = vi.fn(() => socket as never);
    const connecting = openCDPWebSocket(
      "wss://browser.example/devtools/browser/session",
      1_000,
      createSocket,
    );

    socket.open();

    await expect(connecting).resolves.toBe(socket);
    expect(createSocket).toHaveBeenCalledWith("wss://browser.example/devtools/browser/session");
  });

  it("forwards socket errors that occur after connection", () => {
    const socket = new FakeWebSocket();
    const client = new CDPClient(
      socket as never,
      "wss://browser.example/devtools/browser/session",
      1_000,
    );
    const onerror = vi.fn();
    const error = new Error("socket reset");
    client.onerror = onerror;

    socket.fail(error);

    expect(onerror).toHaveBeenCalledWith(error);
  });
});
