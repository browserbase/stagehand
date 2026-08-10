import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  CDPClient,
  CDPConnectionClosedError,
  loadUnpackedExtension,
  openCDPWebSocket,
  stagehandMessageExpression,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";

describe("callback batch expression", () => {
  it("serializes input separately from executable callback source", () => {
    const callbackSource = "async ({ page }, input) => ({ title: await page.title(), input })";
    const message = {
      jsonrpc: "2.0" as const,
      id: 8,
      method: "stagehand.callback_batch",
      params: {
        callback_source: callbackSource,
        input: { text: '"); globalThis.__injectionSucceeded = true; ("' },
        options: { page_id: "page-1", timeout: 2_000 },
      },
    };
    const expression = stagehandMessageExpression(message);

    expect(expression).toContain("__stagehandReceiveFromHost");
    expect(expression).toContain("stagehand.callback_batch");
    expect(expression).toContain(String.raw`\"page_id\":\"page-1\"`);
    expect(expression).not.toContain('"); globalThis.__injectionSucceeded = true; ("');
    expect(expression).toContain("Object.defineProperty");
    expect(expression).toContain("callback: (async");

    let receivedRaw: unknown;
    const workerGlobal = {
      __stagehandReceiveFromHost: (raw: unknown) => {
        receivedRaw = raw;
      },
    };
    expect(runInNewContext(expression, { globalThis: workerGlobal })).toBe(true);
    expect(JSON.parse(receivedRaw as string)).toEqual(message);
    expect(workerGlobal).not.toHaveProperty("__injectionSucceeded");
  });

  it("provides the lexical __name helper used by bundled callback source", async () => {
    const expression = stagehandMessageExpression({
      jsonrpc: "2.0",
      id: 8,
      method: "stagehand.callback_batch",
      params: {
        callback_source: '__name(async () => "ok", "bundledCallback")',
      },
    });
    let attachment: unknown;
    const evaluated = runInNewContext(expression, {
      globalThis: {
        __stagehandReceiveFromHost: (_raw: unknown, received: unknown) => {
          attachment = received;
        },
      },
    }) as unknown;

    expect(evaluated).toBe(true);
    const callback = (attachment as { callback: () => Promise<string> }).callback;
    expect(callback.name).toBe("bundledCallback");
    await expect(callback()).resolves.toBe("ok");
  });
});

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
  it("explains when a Chrome build cannot load unpacked extensions", async () => {
    const signal = new AbortController().signal;
    const cdpError = new Error("Method not available.", {
      cause: {
        code: -32000,
        message: "Method not available.",
        method: "Extensions.loadUnpacked",
      },
    });
    const cdp = {
      sendCommand: vi.fn(async () => {
        throw cdpError;
      }),
    };

    await expect(loadUnpackedExtension(cdp, "/tmp/extension", signal)).rejects.toThrow(
      "This Chrome build does not support Extensions.loadUnpacked",
    );
  });

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
