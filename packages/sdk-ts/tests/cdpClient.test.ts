import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import {
  CDPClient,
  CDPConnectionClosedError,
  isStaleServiceWorker,
  readServiceWorkerBuild,
  resolveExtension,
  StagehandRuntimeIncompatibleError,
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

describe("host CDP relay", () => {
  it("uses the host's headers for extension traffic without sending them to the worker", () => {
    const upstream: Array<
      FakeWebSocket & { url: string; options?: { headers: Record<string, string> } }
    > = [];
    class RelayWebSocket extends FakeWebSocket {
      static readonly OPEN = 1;
      static readonly CONNECTING = 0;
      constructor(
        readonly url: string,
        readonly options?: { headers: Record<string, string> },
      ) {
        super();
        upstream.push(this as (typeof upstream)[number]);
      }
    }
    vi.stubGlobal("WebSocket", RelayWebSocket);
    const host = new FakeWebSocket();
    host.open();
    const client = new CDPClient(host as never, "wss://broker.example/session", true, {
      Authorization: "Bearer test-key",
    });
    client.sessionId = "worker-session";
    const sendEvent = vi.spyOn(client, "sendHostRelayEvent").mockImplementation(() => {});
    const relayId = crypto.randomUUID();
    try {
      client.handleHostRelayMessage({
        kind: "stagehand.host_cdp_relay",
        type: "open",
        id: relayId,
      });
      expect(upstream[0]?.url).toBe("wss://broker.example/session");
      expect(upstream[0]?.options?.headers).toEqual({ Authorization: "Bearer test-key" });
      upstream[0]?.open();
      expect(sendEvent).toHaveBeenCalledWith(relayId, { type: "open" });
      expect(JSON.stringify(sendEvent.mock.calls)).not.toContain("test-key");

      client.handleHostRelayMessage({
        kind: "stagehand.host_cdp_relay",
        type: "send",
        id: relayId,
        data: '{"id":1,"method":"Target.getTargets"}',
      });
      expect(upstream[0]?.send).toHaveBeenCalledOnce();
      client.handleHostRelayMessage({
        kind: "stagehand.host_cdp_relay",
        type: "close",
        id: relayId,
      });
      expect(upstream[0]?.close).toHaveBeenCalledOnce();
    } finally {
      client.close();
      vi.unstubAllGlobals();
    }
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

  it.each([false, true])(
    "notifies explicit close once when socket.close throws: %s",
    async (throws) => {
      const socket = new FakeWebSocket();
      socket.open();
      const client = new CDPClient(socket as never, "ws://localhost/test");
      const onclose = vi.fn(() => client.close());
      client.onclose = onclose;
      const pending = client.sendCommand("Browser.getVersion");
      const rejected = expect(pending).rejects.toThrow("CDP client closed");
      if (throws)
        socket.close.mockImplementation(() => {
          throw new Error("socket close failed");
        });

      if (throws) expect(() => client.close()).toThrow("socket close failed");
      else client.close();
      socket.closeFromRemote();
      client.close();

      await rejected;
      expect(onclose).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "CDP client closed" }),
      );
      expect(socket.close).toHaveBeenCalledOnce();
      expect(client.pending.size).toBe(0);
      expect(client.onclose).toBeUndefined();
    },
  );

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

  it.each([
    { preloadedExtension: true as const },
    { localExtensionDir: "/unused" },
    { localExtensionDir: "/unused", runtimeRequirement: { protocolVersion: "999.0.0" } },
  ])("discovers an installed extension and enforces runtime compatibility: %j", async (source) => {
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
        ...source,
        signal,
      });

      await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
      socket.open();

      if ("runtimeRequirement" in source) {
        await expect(connecting).rejects.toMatchObject({
          name: "StagehandRuntimeIncompatibleError",
        });
        expect(socket.close).toHaveBeenCalledOnce();
        expect(
          socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string).method),
        ).not.toContain("Extensions.loadUnpacked");
        return;
      }
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
        "Runtime.evaluate",
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
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
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
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
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
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
    ).rejects.toThrow("Stagehand extension is installed in the connected browser but is disabled.");
  });

  it("reports multiple enabled Stagehand extensions in deterministic ID order", async () => {
    const signal = new AbortController().signal;
    const sendCommand = vi.fn(async () => ({
      extensions: [extension({ id: "stagehand-z" }), extension({ id: "stagehand-a" })],
    }));

    await expect(
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
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
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
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
      resolveExtension(commandSender(sendCommand), { loadIfNotFound: false, signal }),
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

describe("local extension resolution", () => {
  const unsupported = (method = "Extensions.getExtensions", code = -32601) =>
    new Error("Method not found", { cause: { method, code, message: "Method not found" } });

  it("reuses an installed extension without accessing the fallback directory", async () => {
    const send = vi.fn(async () => ({ extensions: [extension(), extension({ name: "Other" })] }));
    await expect(
      resolveExtension(commandSender(send), {
        loadIfNotFound: true,
        extensionDir: "/does-not-exist",
        signal: new AbortController().signal,
      }),
    ).resolves.toBe("stagehand-extension");
    expect(send.mock.calls).toHaveLength(1);
  });

  it.each(["missing", "unsupported"])("loads once when discovery is %s", async (mode) => {
    const send = vi.fn(async (method: string) => {
      if (method === "Extensions.getExtensions") {
        if (mode === "unsupported") throw unsupported();
        return { extensions: [] };
      }
      return { id: "loaded-extension" };
    });
    const signal = new AbortController().signal;
    await expect(
      resolveExtension(commandSender(send), {
        loadIfNotFound: true,
        extensionDir: "/bundle",
        signal: signal,
      }),
    ).resolves.toBe("loaded-extension");
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Extensions.getExtensions",
      "Extensions.loadUnpacked",
    ]);
    expect(send).toHaveBeenLastCalledWith(
      "Extensions.loadUnpacked",
      { path: "/bundle" },
      undefined,
      signal,
    );
  });

  it.each([
    ["disabled", { extensions: [extension({ enabled: false })] }],
    ["ambiguous", { extensions: [extension({ id: "a" }), extension({ id: "b" })] }],
    ["malformed", { extensions: [{ id: "invalid" }] }],
  ])("does not load on a %s inventory", async (_name, inventory) => {
    const send = vi.fn(async () => inventory);
    await expect(
      resolveExtension(commandSender(send), {
        loadIfNotFound: true,
        extensionDir: "/bundle",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow();
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    new CDPConnectionClosedError(),
    new Error("Permission denied", {
      cause: { method: "Extensions.getExtensions", code: -32000, message: "Permission denied" },
    }),
    unsupported("Other.command"),
    new Error("Method not found"),
  ])("preserves discovery failure without loading: %s", async (error) => {
    const send = vi.fn(async () => {
      throw error;
    });
    await expect(
      resolveExtension(commandSender(send), {
        loadIfNotFound: true,
        extensionDir: "/bundle",
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    "does not load after cancellation during discovery (unsupported: %s)",
    async (isUnsupported) => {
      const controller = new AbortController();
      const error = new Error("cancelled");
      const send = vi.fn(async () => {
        controller.abort(error);
        if (isUnsupported) throw unsupported();
        return { extensions: [] };
      });
      await expect(
        resolveExtension(commandSender(send), {
          loadIfNotFound: true,
          extensionDir: "/bundle",
          signal: controller.signal,
        }),
      ).rejects.toBe(error);
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it("preserves a loading failure without retrying", async () => {
    const error = new Error("load failed");
    const send = vi.fn(async (method: string) => {
      if (method === "Extensions.getExtensions") return { extensions: [] };
      throw error;
    });
    await expect(
      resolveExtension(commandSender(send), {
        loadIfNotFound: true,
        extensionDir: "/bundle",
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("client lifecycle registration", () => {
  function lifecycleClient(options: {
    targetType: string;
    attach: boolean;
    detach?: boolean | Error;
  }) {
    const socket = new FakeWebSocket();
    socket.open();
    const client = new CDPClient(socket as never, "ws://localhost/test");
    const calls: string[] = [];
    vi.spyOn(client, "sendCommand").mockImplementation(async (method, params) => {
      const expression = String((params as { expression?: string } | undefined)?.expression);
      const action = expression.includes('"detach"') ? "detach" : "attach";
      calls.push(method === "Runtime.evaluate" ? action : method);
      if (method === "Target.createTarget") return { targetId: "marker" };
      if (method === "Target.getTargetInfo") return { targetInfo: { type: options.targetType } };
      if (method === "Runtime.evaluate" && action === "detach" && options.detach instanceof Error)
        throw options.detach;
      if (method === "Runtime.evaluate")
        return {
          result: { value: action === "detach" ? (options.detach ?? true) : options.attach },
        };
      return {};
    });
    const register = (closeBrowserOnDisconnect = true) =>
      (
        client as unknown as {
          registerClient(
            policy: { closeBrowserOnDisconnect: boolean },
            signal: AbortSignal,
          ): Promise<void>;
        }
      ).registerClient({ closeBrowserOnDisconnect }, new AbortController().signal);
    return { client, calls, register };
  }

  it.each(["page", "iframe", "worker"])(
    "closes a marker of type %s and requires Chrome 137",
    async (targetType) => {
      const { calls, register } = lifecycleClient({ targetType, attach: true });
      await expect(register()).rejects.toThrow("requires Chrome 137 or later");
      expect(calls).toEqual(["Target.createTarget", "Target.getTargetInfo", "Target.closeTarget"]);
    },
  );

  it("closes the marker and rejects an extension without watchdog support", async () => {
    const { calls, register } = lifecycleClient({ targetType: "other", attach: false });
    await expect(register()).rejects.toThrow("does not support the client watchdog");
    expect(calls).toEqual([
      "Target.createTarget",
      "Target.getTargetInfo",
      "attach",
      "Target.closeTarget",
    ]);
  });

  it("detaches an armed watchdog once", async () => {
    const { client, calls, register } = lifecycleClient({ targetType: "other", attach: true });
    await register();
    await client.detachClient();
    await client.detachClient();
    expect(calls).toEqual(["Target.createTarget", "Target.getTargetInfo", "attach", "detach"]);
  });

  it("treats the connection closing during a detach as a completed detach", async () => {
    // Browserbase ends a keepAlive: false session once the extension closes its connection.
    const { client, calls, register } = lifecycleClient({
      targetType: "other",
      attach: true,
      detach: new CDPConnectionClosedError(),
    });
    await register(false);
    await client.detachClient();
    await client.detachClient();
    expect(calls.filter((call) => call === "detach")).toHaveLength(1);
  });

  it("reports a lost connection during detach when the browser is shut down on loss", async () => {
    const { client, register } = lifecycleClient({
      targetType: "other",
      attach: true,
      detach: new CDPConnectionClosedError(),
    });
    await register(true);
    await expect(client.detachClient()).rejects.toBeInstanceOf(CDPConnectionClosedError);
  });

  it("still rejects a detach that fails with the connection open", async () => {
    const { client, register } = lifecycleClient({
      targetType: "other",
      attach: true,
      detach: new Error("detach timed out"),
    });
    await register();
    await expect(client.detachClient()).rejects.toThrow("detach timed out");
  });

  it("rejects a detach the extension does not acknowledge", async () => {
    const { client, register } = lifecycleClient({
      targetType: "other",
      attach: true,
      detach: false,
    });
    await register();
    await expect(client.detachClient()).rejects.toThrow("did not acknowledge the detach");
  });
});

describe("service worker build check", () => {
  const ready = {
    marker: {
      protocolVersion: STAGEHAND_PROTOCOL_VERSION,
      serverInfo: { name: "stagehand", version: "4.0.2" },
    },
    hasReceiver: true,
  };

  async function connectWith(
    source: (
      | { extensionDir: string }
      | { localExtensionDir: string }
      | { extensionId: string }
      | { preloadedExtension: true }
    ) & { runtimeRequirement?: { protocolVersion: string } },
    builds: Record<string, { running: string | null; onDisk: string | null }>,
    installed: unknown[] = [],
    reloadError?: { code: number; message: string },
  ) {
    const originalWebSocket = globalThis.WebSocket;
    const commands: Array<{
      method: string;
      params?: Record<string, unknown>;
      sessionId?: string;
    }> = [];
    let outcome: { client: CDPClient | undefined; error: Error | undefined };
    try {
      const socket = new FakeWebSocket();
      const createSocket = vi.fn(function WebSocket() {
        return socket;
      });
      Object.defineProperty(createSocket, "OPEN", { value: 1 });
      vi.stubGlobal("WebSocket", createSocket);
      socket.send.mockImplementation((raw: string) => {
        const command = JSON.parse(raw) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
          sessionId?: string;
        };
        const reloading =
          command.method === "Extensions.loadUnpacked" &&
          commands.some(({ params }) => String(params?.expression).includes("build-id.txt"));
        commands.push({
          method: command.method,
          params: command.params,
          sessionId: command.sessionId,
        });
        if (reloading && reloadError) {
          queueMicrotask(() => {
            socket.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ id: command.id, error: reloadError }),
              }),
            );
          });
          return;
        }
        const result = (() => {
          switch (command.method) {
            case "Extensions.getExtensions":
              return { extensions: installed };
            case "Extensions.loadUnpacked":
              return { id: "stagehand-extension" };
            case "Target.getTargets":
              return {
                targetInfos: [
                  reloads(commands).length > 0 && !reloadError ? "new-worker" : "old-worker",
                ].map((targetId) => ({
                  targetId,
                  type: "service_worker",
                  title: "Stagehand",
                  url: "chrome-extension://stagehand-extension/service-worker.js",
                })),
              };
            case "Target.attachToTarget":
              return { sessionId: `${String(command.params?.targetId)}-session` };
            case "Runtime.evaluate":
              return String(command.params?.expression).includes("build-id.txt")
                ? { result: { value: builds[command.sessionId!.replace("-session", "")] } }
                : { result: { value: ready } };
            default:
              return {};
          }
        })();
        queueMicrotask(() => {
          socket.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ id: command.id, result, sessionId: command.sessionId }),
            }),
          );
        });
      });
      const connecting = CDPClient.connect({
        cdpUrl: "ws://127.0.0.1:9222/devtools/browser/session",
        ...source,
        signal: new AbortController().signal,
      });
      await vi.waitFor(() => expect(createSocket).toHaveBeenCalledOnce());
      socket.open();
      outcome = await connecting.then(
        (client) => ({ client, error: undefined }),
        (error: unknown) => ({ client: undefined, error: error as Error }),
      );
    } finally {
      vi.stubGlobal("WebSocket", originalWebSocket);
    }
    outcome.client?.close();
    return { ...outcome, commands };
  }

  function reloads(commands: Array<{ method: string; params?: Record<string, unknown> }>) {
    const firstRead = commands.findIndex(({ params }) =>
      String(params?.expression).includes("build-id.txt"),
    );
    return commands
      .slice(firstRead === -1 ? commands.length : firstRead)
      .flatMap(({ method, params }) =>
        method === "Extensions.loadUnpacked" ? [params?.path] : [],
      );
  }

  it.each([{ extensionDir: "/bundle" }, { localExtensionDir: "/bundle" }])(
    "replaces a worker from another build after loading %j",
    async (source) => {
      const { client, error, commands } = await connectWith(source, {
        "old-worker": { running: null, onDisk: "b".repeat(64) },
        "new-worker": { running: "b".repeat(64), onDisk: "b".repeat(64) },
      });

      expect(error).toBeUndefined();
      expect(client?.serviceWorker.targetId).toBe("new-worker");
      const methods = commands.map(({ method }) => method);
      expect(methods.filter((method) => method.startsWith("Extensions."))).toEqual([
        ...("localExtensionDir" in source ? ["Extensions.getExtensions"] : []),
        "Extensions.loadUnpacked",
        "Extensions.loadUnpacked",
      ]);
      expect(reloads(commands)).toEqual(["/bundle"]);
    },
  );

  it("keeps a matching worker without reloading", async () => {
    const { client, commands } = await connectWith(
      { extensionDir: "/bundle" },
      { "old-worker": { running: "a".repeat(64), onDisk: "a".repeat(64) } },
    );

    expect(client?.serviceWorker.targetId).toBe("old-worker");
    expect(reloads(commands)).toEqual([]);
  });

  it("does not compare a directory without a build identity", async () => {
    const { client, commands } = await connectWith(
      { extensionDir: "/bundle" },
      { "old-worker": { running: "a".repeat(64), onDisk: null } },
    );

    expect(client?.serviceWorker.targetId).toBe("old-worker");
    expect(reloads(commands)).toEqual([]);
  });

  it("does not compare an empty build identity", async () => {
    const { client, commands } = await connectWith(
      { extensionDir: "/bundle" },
      { "old-worker": { running: "a".repeat(64), onDisk: "" } },
    );

    expect(client?.serviceWorker.targetId).toBe("old-worker");
    expect(reloads(commands)).toEqual([]);
  });

  async function withBundle(run: (bundle: string, root: string) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), "stagehand-bundle-"));
    try {
      const bundle = path.join(root, "Bundle");
      await mkdir(bundle);
      await run(bundle, root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }

  async function connectInstalledFrom(installedPath: string, localExtensionDir: string) {
    return await connectWith(
      { localExtensionDir },
      {
        "old-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) },
        "new-worker": { running: "b".repeat(64), onDisk: "b".repeat(64) },
      },
      [extension({ id: "stagehand-extension", path: installedPath })],
    );
  }

  it.each([
    ["the same path", (bundle: string) => bundle],
    ["a trailing slash", (bundle: string) => `${bundle}/`],
    ["a symlink", (_: string, root: string) => path.join(root, "link")],
  ])(
    "replaces a worker from another build when the extension is installed from its own directory given as %s",
    async (_, localDir) => {
      await withBundle(async (bundle, root) => {
        await symlink(bundle, path.join(root, "link"));
        const { client, error, commands } = await connectInstalledFrom(
          bundle,
          localDir(bundle, root),
        );

        expect(error).toBeUndefined();
        expect(client?.serviceWorker.targetId).toBe("new-worker");
        expect(
          commands.map(({ method }) => method).filter((method) => method.startsWith("Extensions.")),
        ).toEqual(["Extensions.getExtensions", "Extensions.loadUnpacked"]);
        expect(reloads(commands)).toEqual([localDir(bundle, root)]);
      });
    },
  );

  it("treats a directory given in another letter case as its own on a case-insensitive filesystem", async (context) => {
    await withBundle(async (bundle) => {
      const upper = path.join(path.dirname(bundle), "BUNDLE");
      const caseInsensitive = await stat(upper).then(
        () => true,
        () => false,
      );
      if (!caseInsensitive) context.skip();
      const { client, error } = await connectInstalledFrom(bundle, upper);

      expect(error).toBeUndefined();
      expect(client?.serviceWorker.targetId).toBe("new-worker");
    });
  });

  it.each(["/missing/bundle", "/missing/other/../bundle/"])(
    "treats a path it cannot read as its own directory when it names the same path: %s",
    async (localExtensionDir) => {
      const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
      try {
        const { client, error, commands } = await connectInstalledFrom(
          "/missing/bundle",
          localExtensionDir,
        );

        expect(error).toBeUndefined();
        expect(client?.serviceWorker.targetId).toBe("new-worker");
        expect(reloads(commands)).toEqual([localExtensionDir]);
        expect(emitWarning).not.toHaveBeenCalled();
      } finally {
        emitWarning.mockRestore();
      }
    },
  );

  it("does not treat a path it cannot read as its own directory when it names another path", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const { client, commands } = await connectInstalledFrom("/missing/bundle", "/missing/other");

      expect(client?.serviceWorker.targetId).toBe("old-worker");
      expect(reloads(commands)).toEqual([]);
      expect(emitWarning).toHaveBeenCalledOnce();
    } finally {
      emitWarning.mockRestore();
    }
  });

  it.each([
    { localExtensionDir: "/bundle" },
    { extensionId: "stagehand-extension" },
    { preloadedExtension: true as const },
  ])("warns and continues with an extension Stagehand does not own: %j", async (source) => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const { client, error, commands } = await connectWith(
        source,
        { "old-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) } },
        [extension({ id: "stagehand-extension" })],
      );

      expect(error).toBeUndefined();
      expect(client?.serviceWorker.targetId).toBe("old-worker");
      expect(emitWarning).toHaveBeenCalledOnce();
      expect(emitWarning.mock.calls[0][0]).toContain(
        `runs service worker build ${"a".repeat(64)}, but its directory holds build ${"b".repeat(64)}: the browser profile kept the worker of another build`,
      );
      expect(commands.map(({ method }) => method)).not.toContain("Extensions.loadUnpacked");
      expect(reloads(commands)).toEqual([]);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("keeps the incompatibility error for a worker Stagehand does not replace", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const { error } = await connectWith(
        { extensionId: "stagehand-extension", runtimeRequirement: { protocolVersion: "999.0.0" } },
        { "old-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) } },
      );

      expect(error).toBeInstanceOf(StagehandRuntimeIncompatibleError);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("warns and continues when the reloaded worker still runs another build", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const { client, error, commands } = await connectWith(
        { extensionDir: "/bundle" },
        {
          "old-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) },
          "new-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) },
        },
      );

      expect(error).toBeUndefined();
      expect(client?.serviceWorker.targetId).toBe("new-worker");
      expect(emitWarning).toHaveBeenCalledOnce();
      expect(emitWarning.mock.calls[0]).toEqual([
        `The Stagehand extension stagehand-extension still runs service worker build ${"a".repeat(64)} after it was reloaded from a directory that holds build ${"b".repeat(64)}, so Stagehand continues with the running worker.`,
        { code: "STAGEHAND_STALE_SERVICE_WORKER" },
      ]);
      expect(reloads(commands)).toEqual(["/bundle"]);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("warns and continues when loading the extension again fails", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const { client, error, commands } = await connectWith(
        { extensionDir: "/bundle" },
        { "old-worker": { running: "a".repeat(64), onDisk: "b".repeat(64) } },
        [],
        { code: -32000, message: "Manifest file is missing or unreadable" },
      );

      expect(error).toBeUndefined();
      expect(client?.serviceWorker.targetId).toBe("old-worker");
      expect(emitWarning.mock.calls).toEqual([
        [
          `The Stagehand extension stagehand-extension runs service worker build ${"a".repeat(64)}, but its directory holds build ${"b".repeat(64)}: the browser profile kept the worker of another build. Stagehand could not load this extension again from its directory to replace the worker, so it continues with the running worker.`,
          { code: "STAGEHAND_STALE_SERVICE_WORKER" },
        ],
      ]);
      expect(reloads(commands)).toEqual(["/bundle"]);
    } finally {
      emitWarning.mockRestore();
    }
  });

  it("waits for the runtime marker before reading the build", async () => {
    const delayFn = vi.fn(async () => {});
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ result: { value: null } })
      .mockResolvedValueOnce({ result: { value: { running: "a", onDisk: "b" } } });

    await expect(
      readServiceWorkerBuild({ sendCommand }, "worker-session", {
        delayFn,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ running: "a", onDisk: "b" });
    expect(delayFn).toHaveBeenCalledOnce();
    expect(sendCommand).toHaveBeenLastCalledWith(
      "Runtime.evaluate",
      expect.objectContaining({ awaitPromise: true, returnByValue: true }),
      "worker-session",
      expect.any(AbortSignal),
    );
  });

  it("retries a build read that throws while the worker context starts", async () => {
    const delayFn = vi.fn(async () => {});
    const sendCommand = vi
      .fn()
      .mockRejectedValueOnce(new Error("Cannot find default execution context"))
      .mockResolvedValueOnce({ result: { value: { running: "a", onDisk: "b" } } });

    await expect(
      readServiceWorkerBuild({ sendCommand }, "worker-session", {
        delayFn,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ running: "a", onDisk: "b" });
    expect(delayFn).toHaveBeenCalledOnce();
  });

  it("does not compare when the build read keeps throwing", async () => {
    const delayFn = vi.fn(async () => {});
    const sendCommand = vi.fn().mockRejectedValue(new Error("Execution context was destroyed"));

    await expect(
      readServiceWorkerBuild({ sendCommand }, "worker-session", {
        delayFn,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ running: null, onDisk: null });
    expect(sendCommand).toHaveBeenCalledTimes(16);
    expect(delayFn).toHaveBeenCalledTimes(15);
  });

  it("stops reading the build when the connection closes", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new CDPConnectionClosedError());

    await expect(
      readServiceWorkerBuild({ sendCommand }, "worker-session", {
        delayFn: async () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(CDPConnectionClosedError);
    expect(sendCommand).toHaveBeenCalledOnce();
  });

  it.each([
    [{ running: "a", onDisk: "a" }, false],
    [{ running: "a", onDisk: "b" }, true],
    [{ running: null, onDisk: "b" }, true],
    [{ running: "a", onDisk: null }, false],
    [{ running: null, onDisk: null }, false],
    [{ running: "__STAGEHAND_EXTENSION_BUILD_ID__", onDisk: "b" }, false],
    [{ running: "a", onDisk: "__STAGEHAND_EXTENSION_BUILD_ID__" }, false],
    [{ running: "a", onDisk: "" }, false],
    [{ running: "", onDisk: "b" }, false],
  ])("treats %j as stale: %s", (build, stale) => {
    expect(isStaleServiceWorker(build)).toBe(stale);
  });
});
