import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import {
  CDPClient,
  CDPConnectionClosedError,
  discoverInstalledStagehandExtensionId,
  openCDPWebSocket,
  stagehandMessageExpression,
  waitForRuntimeReady,
  waitForServiceWorker,
} from "../src/cdpClient.js";

function extension(
  overrides: Partial<Record<"id" | "name" | "version" | "path" | "enabled", unknown>> = {},
) {
  return {
    id: "stagehand-extension",
    name: "Stagehand Runtime",
    version: "4.0.2",
    path: "/remote/stagehand-extension",
    enabled: true,
    ...overrides,
  };
}

function commandSender(
  sendCommand: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    signal?: AbortSignal,
  ) => Promise<unknown>,
) {
  return {
    async sendCommand<Result = Record<string, unknown>>(
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
      signal?: AbortSignal,
    ): Promise<Result> {
      return (await sendCommand(method, params, sessionId, signal)) as Result;
    },
  };
}

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

  closeFromRemote(): void {
    this.readyState = 3;
    this.dispatchEvent(new CloseEvent("close"));
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

  it("normalizes an Undici socket error before close as one connection-closed failure", async () => {
    const socket = new FakeWebSocket();
    socket.open();
    const client = new CDPClient(socket as never, "wss://browser.example/devtools/browser/session");
    const onerror = vi.fn();
    const onclose = vi.fn();
    const error = new TypeError();
    client.onerror = onerror;
    client.onclose = onclose;

    const command = client.sendCommand("Browser.getVersion");

    socket.fail(error);
    socket.closeFromRemote();

    await expect(command).rejects.toMatchObject({
      name: "CDPConnectionClosedError",
      message: "CDP connection closed",
      cause: error,
    });
    expect(onerror).toHaveBeenCalledOnce();
    expect(onerror).toHaveBeenCalledWith(expect.any(CDPConnectionClosedError));
    expect(onclose).not.toHaveBeenCalled();
    expect(client.closed).toBe(true);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it("discovers an installed extension before attaching to its ready worker", async () => {
    const signal = new AbortController().signal;
    const socket = new FakeWebSocket();
    const originalWebSocket = globalThis.WebSocket;
    const createSocket = vi.fn(function WebSocket() {
      return socket;
    });
    Object.defineProperty(createSocket, "OPEN", { value: 1 });
    vi.stubGlobal("WebSocket", createSocket);
    socket.send.mockImplementation((raw: string) => {
      const command = JSON.parse(raw) as {
        id: number;
        method: string;
        sessionId?: string;
      };
      const result = (() => {
        switch (command.method) {
          case "Extensions.getExtensions":
            return { extensions: [extension({ id: "installed-stagehand" })] };
          case "Target.getTargets":
            return {
              targetInfos: [
                {
                  targetId: "stagehand-worker",
                  type: "service_worker",
                  title: "Stagehand",
                  url: "chrome-extension://installed-stagehand/service-worker.js",
                },
              ],
            };
          case "Target.attachToTarget":
            return { sessionId: "worker-session" };
          case "Runtime.evaluate":
            return {
              result: {
                value: {
                  marker: {
                    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
                    serverInfo: { name: "stagehand", version: "4.0.2" },
                  },
                  hasReceiver: true,
                },
              },
            };
          default:
            return {};
        }
      })();

      queueMicrotask(() => {
        socket.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              id: command.id,
              result,
              ...(command.sessionId ? { sessionId: command.sessionId } : {}),
            }),
          }),
        );
      });
    });
    try {
      const connecting = CDPClient.connect({
        cdpUrl: "wss://browser.example/devtools/browser/session",
        preloadedExtension: true,
        signal,
      });

      await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
      socket.open();

      const client = await connecting;
      expect(createSocket).toHaveBeenCalledWith("wss://browser.example/devtools/browser/session");
      expect(client.serviceWorker).toStrictEqual({
        targetId: "stagehand-worker",
        title: "Stagehand",
        url: "chrome-extension://installed-stagehand/service-worker.js",
        extensionId: "installed-stagehand",
      });
      expect(
        socket.send.mock.calls.map(
          ([raw]) => (JSON.parse(raw as string) as { method: string }).method,
        ),
      ).toStrictEqual([
        "Extensions.getExtensions",
        "Target.getTargets",
        "Target.attachToTarget",
        "Runtime.enable",
        "Runtime.addBinding",
        "Runtime.evaluate",
      ]);
      client.close();
    } finally {
      vi.stubGlobal("WebSocket", originalWebSocket);
    }
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

describe("installed Stagehand extension discovery", () => {
  it("returns the Chrome ID of the single enabled Stagehand extension", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({
      extensions: [
        extension({ id: "unrelated", name: "Other Extension" }),
        extension({ id: "installed-stagehand" }),
      ],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).resolves.toBe("installed-stagehand");
    expect(sendCommand).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenCalledWith("Extensions.getExtensions", {}, undefined, signal);
  });

  it("reports a missing extension immediately from the installed inventory", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({
      extensions: [extension({ id: "unrelated", name: "Other Extension" })],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).rejects.toThrow(
      "Stagehand extension is not installed in the connected browser. " +
        "The extension must be included when the Browserbase session is created.",
    );
    expect(sendCommand).toHaveBeenCalledOnce();
  });

  it("reports an installed but disabled Stagehand extension", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({ extensions: [extension({ enabled: false })] }));

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).rejects.toThrow("Stagehand extension is installed in the connected browser but is disabled.");
  });

  it("reports multiple enabled Stagehand extensions in deterministic ID order", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({
      extensions: [extension({ id: "stagehand-z" }), extension({ id: "stagehand-a" })],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).rejects.toThrow(
      "Multiple enabled Stagehand extensions are installed: stagehand-a, stagehand-z",
    );
  });

  it("rejects malformed extension inventory responses", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({
      extensions: [extension({ enabled: "yes" })],
    }));

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).rejects.toThrow();
  });

  it("propagates inventory command failures without scanning targets", async () => {
    const signal = new AbortController().signal;
    const commandError = new Error("Method not available");
    const sendCommand = vi.fn(async (method: string) => {
      if (method === "Extensions.getExtensions") throw commandError;
      return {};
    });

    await expect(
      discoverInstalledStagehandExtensionId(commandSender(sendCommand), { signal }),
    ).rejects.toBe(commandError);
    expect(sendCommand).toHaveBeenCalledOnce();
  });
});

describe("Stagehand service worker discovery", () => {
  it("selects only the service worker belonging to the resolved extension ID", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: "other-worker",
            type: "service_worker",
            title: "Other",
            url: "chrome-extension://other-extension/service-worker.js",
          },
        ],
      })
      .mockResolvedValueOnce({
        targetInfos: [
          {
            targetId: "stagehand-worker",
            type: "service_worker",
            title: "Stagehand",
            url: "chrome-extension://stagehand-extension/service-worker.js",
          },
        ],
      });

    await expect(
      waitForServiceWorker(commandSender(sendCommand), {
        extensionId: "stagehand-extension",
        activationDelayMs: 60_000,
        delayFn: async () => {},
        signal,
      }),
    ).resolves.toMatchObject({ targetId: "stagehand-worker" });
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });
});
