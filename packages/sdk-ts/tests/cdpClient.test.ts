import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  CDPClient,
  CDPConnectionClosedError,
  callbackBatchExpression,
  openCDPWebSocket,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";

describe("callback batch expression", () => {
  it("serializes input separately from executable callback source", () => {
    const expression = callbackBatchExpression({
      callbackSource: "async ({ page }, input) => ({ title: await page.title(), input })",
      input: { text: '"); globalThis.__injectionSucceeded = true; ("' },
      pageId: "page-1",
      timeout: 2_000,
    });

    expect(expression).toContain("__stagehandRunCallbackBatch");
    expect(expression).toContain('"pageId":"page-1"');
    expect(expression).toContain(String.raw`\"); globalThis.__injectionSucceeded = true; (\"`);
    expect(expression).not.toContain('"); globalThis.__injectionSucceeded = true; ("');
    expect(expression).toContain("Object.defineProperty");
    expect(expression).not.toContain('"callbackSource":');
    expect(expression).not.toContain('"input":');
  });

  it("provides the lexical __name helper used by bundled callback source", async () => {
    const expression = callbackBatchExpression({
      callbackSource: '__name(async () => "ok", "bundledCallback")',
      input: undefined,
      timeout: 2_000,
    });
    const evaluated = runInNewContext(expression, {
      globalThis: {
        __stagehandRunCallbackBatch: async (callback: () => Promise<string>) => ({
          ok: true,
          value: { name: callback.name, result: await callback() },
        }),
      },
    }) as Promise<unknown>;

    await expect(evaluated).resolves.toEqual({
      ok: true,
      value: { name: "bundledCallback", result: "ok" },
    });
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

async function decodeCallbackBatchEnvelope(envelope: unknown): Promise<unknown> {
  const socket = new FakeWebSocket();
  const client = new CDPClient(socket as never, "wss://browser.example/devtools/browser/session");
  client.sessionId = "worker-session";
  vi.spyOn(client, "sendCommand").mockResolvedValue({ result: { value: envelope } } as never);
  try {
    return await client.runCallbackBatch({
      callbackSource: "async () => undefined",
      input: undefined,
      timeout: 1_000,
    });
  } finally {
    client.close();
  }
}

describe("callback batch result envelope", () => {
  it("requires an explicit value or undefined marker on success", async () => {
    await expect(decodeCallbackBatchEnvelope({ ok: true })).rejects.toThrow();
    await expect(
      decodeCallbackBatchEnvelope({ ok: true, value: null, valueIsUndefined: true }),
    ).rejects.toThrow();
  });

  it("accepts explicit null and undefined success results", async () => {
    await expect(decodeCallbackBatchEnvelope({ ok: true, value: null })).resolves.toBeNull();
    await expect(
      decodeCallbackBatchEnvelope({ ok: true, valueIsUndefined: true }),
    ).resolves.toBeUndefined();
  });
});

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
