import { describe, expect, it, vi } from "vitest";
import {
  CDPClient,
  CDPConnectionClosedError,
  openCDPWebSocket,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";

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
    const signal = new AbortController().signal;
    const socket = new FakeWebSocket();
    const createSocket = vi.fn(() => socket as never);
    const connecting = openCDPWebSocket(
      "wss://browser.example/devtools/browser/session",
      signal,
      createSocket,
    );

    socket.open();

    await expect(connecting).resolves.toBe(socket);
    expect(createSocket).toHaveBeenCalledWith("wss://browser.example/devtools/browser/session");
  });

  it("forwards socket errors that occur after connection", () => {
    const socket = new FakeWebSocket();
    const client = new CDPClient(socket as never, "wss://browser.example/devtools/browser/session");
    const onerror = vi.fn();
    const error = new Error("socket reset");
    client.onerror = onerror;

    socket.fail(error);

    expect(onerror).toHaveBeenCalledWith(error);
  });

  it("fails runtime readiness immediately when CDP disconnects", async () => {
    const disconnect = new CDPConnectionClosedError();
    const delayFn = vi.fn(async () => {});
    const signal = new AbortController().signal;
    const cdp = {
      sendCommand: vi.fn(async () => {
        throw disconnect;
      }),
    };

    await expect(waitForRuntimeReady(cdp, "worker-session", { delayFn, signal })).rejects.toBe(
      disconnect,
    );
    expect(delayFn).not.toHaveBeenCalled();
  });

  it("closes a wake target after cancellation without reusing the aborted signal", async () => {
    const controller = new AbortController();
    const reason = new Error("initialization expired");
    const sendCommand = vi.fn(
      async (
        method: string,
        _params?: Record<string, unknown>,
        _sessionId?: string,
        _signal?: AbortSignal,
      ): Promise<Record<string, unknown>> => {
        if (method === "Target.getTargets") return { targetInfos: [] };
        if (method === "Target.createTarget") return { targetId: "wake-target" };
        return {};
      },
    );
    const cdp = {
      async sendCommand<Result = Record<string, unknown>>(
        method: string,
        params?: Record<string, unknown>,
        sessionId?: string,
        signal?: AbortSignal,
      ): Promise<Result> {
        return (await sendCommand(method, params, sessionId, signal)) as Result;
      },
    };

    const waiting = waitForServiceWorker(cdp, {
      extensionId: "stagehand-extension",
      activationDelayMs: 0,
      signal: controller.signal,
      delayFn: async () => controller.abort(reason),
    });

    await expect(waiting).rejects.toBe(reason);
    expect(sendCommand).toHaveBeenCalledWith("Target.getTargets", {}, undefined, controller.signal);
    expect(sendCommand).toHaveBeenCalledWith(
      "Target.createTarget",
      { url: "chrome-extension://stagehand-extension/wake-service-worker.html" },
      undefined,
      controller.signal,
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "Target.closeTarget",
      { targetId: "wake-target" },
      undefined,
      undefined,
    );
  });
});
