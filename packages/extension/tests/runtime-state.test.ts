import { ROOT_CONTEXT } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { StagehandInitParams } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandBrowserSession } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";
import { StagehandRuntimeStateSchema } from "../runtimeState.js";

const runtimeIdentity = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-test", version: "1.0.0" },
  logLevel: "info" as const,
};

function createBrowserSession(
  overrides: Partial<StagehandBrowserSession> = {},
): StagehandBrowserSession {
  return {
    connected: true,
    pages: () => [],
    newPage: async () => {
      throw new Error("Not used by this test");
    },
    activePage: async () => undefined,
    setActivePage: async () => {},
    addInitScript: async () => {},
    setExtraHTTPHeaders: async () => {},
    getDomainPolicy: () => null,
    setDomainPolicy: async () => {},
    cookies: async () => [],
    addCookies: async () => {},
    clearCookies: async () => {},
    clipboard: {
      readText: async () => "",
      writeText: async () => {},
      clear: async () => {},
      paste: async () => {},
      copy: async () => {},
      cut: async () => {},
    },
    close: async () => {},
    ...overrides,
  };
}

describe("Stagehand runtime state", () => {
  it.each([{ apiKey: "old-key" }, { apiUrl: "https://example.com" }])(
    "rejects removed init options in runtime state: %j",
    (options) => {
      expect(
        StagehandRuntimeStateSchema.safeParse({
          status: "initialized",
          initParams: { ...runtimeIdentity, ...options },
        }).success,
      ).toBe(false);
    },
  );

  it("retains provider settings alongside client Browserbase metadata", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession(),
    });
    const params: StagehandInitParams = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      browserbase: "client" as const,
      browser: { sessionId: "session-123" },
      model: {
        modelName: "openai/gpt-5",
        apiKey: "provider-key",
        headers: { "x-provider": "value" },
      },
    };
    await runtime.initialize(params);
    expect(runtime.state.getState()).toStrictEqual({ status: "initialized", initParams: params });
    await runtime.disposeStagehandInstance();
  });

  it("keeps the persistent browser session on the neutral runtime logger", async () => {
    const browserSessionFactory = vi.fn(async () => createBrowserSession());
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const initLogger = runtime.logger.withContext(ROOT_CONTEXT);

    await runtime.initialize(
      {
        ...runtimeIdentity,
        browserCdpUrl: "ws://browser.example",
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      },
      initLogger,
    );

    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://browser.example",
      runtime.logger,
      initLogger,
    );
  });

  it("replaces a retained browser session when its loopback connection is closed", async () => {
    const closeDisconnectedSession = vi.fn();
    const connectedSession = createBrowserSession();
    const browserSessionFactory = vi.fn(async () => connectedSession);
    const runtime = createStagehandRuntime({ browserSessionFactory });
    runtime.browserSession = createBrowserSession({
      connected: false,
      close: closeDisconnectedSession,
    });

    await expect(
      runtime.initialize({
        ...runtimeIdentity,
        browserCdpUrl: "ws://browser.example/reconnected",
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      }),
    ).resolves.toStrictEqual({ initialized: true, pages: [] });

    expect(closeDisconnectedSession).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://browser.example/reconnected",
      runtime.logger,
      runtime.logger,
    );
    expect(runtime.browserSession).toBe(connectedSession);
  });

  it("stores the exact validated Stagehand init params after initialization", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession(),
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...runtimeIdentity,
      model: { modelName: "openai/gpt-5" },
      telemetry: {
        traces: {
          endpoint: "https://collector.example.com/v1/traces",
          headers: { Authorization: "Bearer test" },
        },
      },
      selfHeal: true,
    });

    expect(runtime.state.getState()).toStrictEqual({
      status: "initialized",
      initParams: {
        ...runtimeIdentity,
        model: { modelName: "openai/gpt-5" },
        telemetry: {
          traces: {
            endpoint: "https://collector.example.com/v1/traces",
            headers: { Authorization: "Bearer test" },
          },
        },
        selfHeal: true,
      },
    });
  });

  it("rejects initialization while another Stagehand instance is initialized", async () => {
    const prepareForInitialization = vi.fn();
    const browserSessionFactory = vi.fn(async () =>
      createBrowserSession({ prepareForInitialization }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...runtimeIdentity,
      model: { modelName: "openai/gpt-5" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    const replacementParams: StagehandInitParams = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example/different",
      model: { modelName: "anthropic/claude-sonnet-4-5" },
      systemPrompt: "Replacement caller",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };

    await expect(runtime.initialize(replacementParams)).rejects.toThrow(
      "A Stagehand instance is already initialized",
    );

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(prepareForInitialization).toHaveBeenCalledOnce();
    expect(runtime.state.getState()).toStrictEqual({
      status: "initialized",
      initParams: {
        ...runtimeIdentity,
        model: { modelName: "openai/gpt-5" },
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      },
    });
  });

  it("returns to a neutral state and reuses the browser session after Stagehand disposal", async () => {
    const sessions: StagehandBrowserSession[] = [];
    const close = vi.fn();
    const prepareForInitialization = vi.fn();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => {
        const session = createBrowserSession({ close, prepareForInitialization });
        sessions.push(session);
        return session;
      },
    });

    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };
    await runtime.initialize(params);
    await runtime.disposeStagehandInstance();

    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
    expect(close).not.toHaveBeenCalled();

    await expect(runtime.initialize(params)).resolves.toStrictEqual({
      initialized: true,
      pages: [],
    });
    expect(sessions).toHaveLength(1);
    expect(prepareForInitialization).toHaveBeenCalledTimes(2);
    expect(runtime.state.getState()).toMatchObject({ status: "initialized" });
  });

  it("replaces a live browser connection when the next instance supplies a different URL", async () => {
    const closePrevious = vi.fn();
    const previous = createBrowserSession({ close: closePrevious });
    const replacement = createBrowserSession();
    const browserSessionFactory = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockImplementationOnce(async () => {
        expect(closePrevious).toHaveBeenCalledOnce();
        return replacement;
      });
    const runtime = createStagehandRuntime({ browserSessionFactory });

    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "wss://gateway.example/cdp" });
    await runtime.disposeStagehandInstance();
    expect(closePrevious).not.toHaveBeenCalled();

    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://127.0.0.1:9300/devtools/browser/abc",
    };
    await expect(runtime.initialize(params)).resolves.toStrictEqual({
      initialized: true,
      pages: [],
    });
    expect(browserSessionFactory).toHaveBeenCalledTimes(2);
    expect(browserSessionFactory).toHaveBeenLastCalledWith(
      params.browserCdpUrl,
      runtime.logger,
      runtime.logger,
    );
    expect(runtime.browserSession).toBe(replacement);
    expect(runtime.state.getState()).toStrictEqual({ status: "initialized", initParams: params });
    await runtime.close();
  });

  it("reuses a live browser connection when the next instance omits the URL", async () => {
    const close = vi.fn();
    const prepareForInitialization = vi.fn();
    const session = createBrowserSession({ close, prepareForInitialization });
    const browserSessionFactory = vi.fn(async () => session);
    const runtime = createStagehandRuntime({ browserSessionFactory });

    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    await runtime.disposeStagehandInstance();
    await runtime.initialize(runtimeIdentity);

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(prepareForInitialization).toHaveBeenCalledTimes(2);
    expect(runtime.browserSession).toBe(session);
    await runtime.close();
  });

  it("can retry a changed endpoint after replacement fails", async () => {
    const closePrevious = vi.fn();
    const previous = createBrowserSession({ close: closePrevious });
    const replacement = createBrowserSession();
    const browserSessionFactory = vi
      .fn()
      .mockResolvedValueOnce(previous)
      .mockRejectedValueOnce(new Error("CDP connection failed"))
      .mockResolvedValueOnce(replacement);
    const runtime = createStagehandRuntime({ browserSessionFactory });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example/old" });
    await runtime.disposeStagehandInstance();

    const params = { ...runtimeIdentity, browserCdpUrl: "ws://browser.example/new" };
    await expect(runtime.initialize(params)).rejects.toThrow("CDP connection failed");
    expect(closePrevious).toHaveBeenCalledOnce();
    expect(runtime.browserSession).toBeUndefined();
    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });

    await expect(runtime.initialize(params)).resolves.toStrictEqual({
      initialized: true,
      pages: [],
    });
    expect(browserSessionFactory).toHaveBeenCalledTimes(3);
    expect(browserSessionFactory).toHaveBeenLastCalledWith(
      params.browserCdpUrl,
      runtime.logger,
      runtime.logger,
    );
    expect(runtime.browserSession).toBe(replacement);
    expect(closePrevious).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("waits for runtime disposal before initializing the next Stagehand instance", async () => {
    let markCloseStarted!: () => void;
    const closeStarted = new Promise<void>((resolve) => {
      markCloseStarted = resolve;
    });
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const sessions: StagehandBrowserSession[] = [];
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => {
        const session = createBrowserSession({
          close:
            sessions.length === 0
              ? async () => {
                  markCloseStarted();
                  await closeGate;
                }
              : async () => {},
        });
        sessions.push(session);
        return session;
      },
    });
    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };
    await runtime.initialize(params);

    const closing = runtime.close();
    await closeStarted;
    const initializing = runtime.initialize(params);
    await Promise.resolve();

    expect(sessions).toHaveLength(1);

    releaseClose();
    await closing;
    await expect(initializing).resolves.toStrictEqual({ initialized: true, pages: [] });
    expect(sessions).toHaveLength(2);
    expect(runtime.state.getState()).toMatchObject({ status: "initialized" });
  });

  it("leaves server state unchanged when initialization fails", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () =>
        createBrowserSession({
          pages: () => {
            throw new Error("Could not read pages");
          },
        }),
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });

    await expect(
      runtime.initialize({
        ...runtimeIdentity,
        telemetry: {
          traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
        },
      }),
    ).rejects.toThrow("Could not read pages");
    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
  });

  it("rejects concurrent initialization before creating another browser session", async () => {
    let releaseInitialization!: () => void;
    const initializationGate = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    const browserSessionFactory = vi.fn(async () =>
      createBrowserSession({ prepareForInitialization: async () => await initializationGate }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const params = {
      ...runtimeIdentity,
      browserCdpUrl: "ws://browser.example",
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    };

    const firstInitialization = runtime.initialize(params);
    await expect(runtime.initialize(params)).rejects.toThrow(
      "Stagehand initialization is already in progress",
    );
    expect(browserSessionFactory).toHaveBeenCalledOnce();

    releaseInitialization();
    await expect(firstInitialization).resolves.toMatchObject({ initialized: true });
  });

  it("clears initialized configuration without closing the browser session", async () => {
    const close = vi.fn();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession({ close }),
    });

    await runtime.replaceBrowserConnection({
      cdpUrl: "ws://browser.example",
    });
    await runtime.initialize({
      ...runtimeIdentity,
      model: { modelName: "openai/gpt-5", apiKey: "secret" },
      telemetry: {
        traces: { endpoint: "https://collector.example.com/v1/traces", headers: {} },
      },
    });

    await runtime.disposeStagehandInstance();

    expect(runtime.state.getState()).toStrictEqual({ status: "idle" });
    expect(close).not.toHaveBeenCalled();
  });
});

describe("runtime browser connection", () => {
  it.each(["drop", "replace", "close"] as const)(
    "retries failed session cleanup through %s without reusing the disconnected session",
    async (operation) => {
      let rulesInstalled = true;
      const cleanup = vi
        .fn(async () => {
          rulesInstalled = false;
        })
        .mockRejectedValueOnce(new Error("cleanup failed"))
        .mockRejectedValueOnce(new Error("cleanup failed again"));
      const previous = createBrowserSession({ close: cleanup });
      const replacement = createBrowserSession();
      const factory = vi.fn().mockResolvedValueOnce(previous).mockResolvedValue(replacement);
      const runtime = createStagehandRuntime({ browserSessionFactory: factory });
      await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example/old" });
      const run = () =>
        operation === "drop"
          ? runtime.disconnectBrowser()
          : operation === "close"
            ? runtime.close()
            : runtime.replaceBrowserConnection({ cdpUrl: "ws://browser.example/new" });

      await expect(run()).rejects.toThrow("cleanup failed");
      expect(rulesInstalled).toBe(true);
      expect(runtime.browserSession).toBeUndefined();
      expect(() => runtime.requireBrowserSession()).toThrow("not configured");
      await expect(run()).rejects.toThrow("cleanup failed again");
      expect(rulesInstalled).toBe(true);
      expect(factory).toHaveBeenCalledOnce();

      await run();
      expect(rulesInstalled).toBe(false);
      expect(cleanup).toHaveBeenCalledTimes(3);
      expect(runtime.browserSession).toBe(operation === "replace" ? replacement : undefined);
      await runtime.disconnectBrowser();
      expect(cleanup).toHaveBeenCalledTimes(3);
    },
  );

  it("shares pending cleanup between drop and replacement before opening a new connection", async () => {
    const gate = Promise.withResolvers<void>();
    const cleanup = vi.fn(() => gate.promise);
    const previous = createBrowserSession({ close: cleanup });
    const replacement = createBrowserSession();
    const factory = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(replacement);
    const runtime = createStagehandRuntime({ browserSessionFactory: factory });
    await runtime.replaceBrowserConnection({ cdpUrl: "ws://browser.example/old" });
    const dropping = runtime.disconnectBrowser();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    const replacing = runtime.replaceBrowserConnection({ cdpUrl: "ws://browser.example/new" });
    await Promise.resolve();
    expect(factory).toHaveBeenCalledOnce();
    gate.resolve();
    await Promise.all([dropping, replacing]);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.browserSession).toBe(replacement);
  });

  it("does not open a replacement if dropped while previous-session cleanup is pending", async () => {
    const gate = Promise.withResolvers<void>();
    const cleanup = vi.fn(() => gate.promise);
    const factory = vi.fn(async () => createBrowserSession({ close: cleanup }));
    const runtime = createStagehandRuntime({ browserSessionFactory: factory });
    await runtime.replaceBrowserConnection({ cdpUrl: "ws://browser.example/old" });
    const replacing = runtime.replaceBrowserConnection({ cdpUrl: "ws://browser.example/new" });
    const rejected = expect(replacing).rejects.toThrow("dropped while connecting");
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    const dropping = runtime.disconnectBrowser();
    gate.resolve();
    await Promise.all([rejected, dropping]);
    expect(factory).toHaveBeenCalledOnce();
    expect(runtime.browserSession).toBeUndefined();
  });

  it("retains cleanup for a connection that finishes opening after a drop", async () => {
    const gate = Promise.withResolvers<StagehandBrowserSession>();
    const cleanup = vi.fn(async () => {}).mockRejectedValueOnce(new Error("late cleanup failed"));
    const factory = vi.fn(() => gate.promise);
    const runtime = createStagehandRuntime({ browserSessionFactory: factory });
    const connecting = runtime.ensureBrowserConnection("ws://browser.example");
    await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
    await runtime.disconnectBrowser();
    gate.resolve(createBrowserSession({ close: cleanup }));
    await expect(connecting).rejects.toThrow("late cleanup failed");
    expect(runtime.browserSession).toBeUndefined();
    await runtime.disconnectBrowser();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
  it("closes a connection that finishes opening after it was dropped", async () => {
    let finish!: () => void;
    const close = vi.fn(async () => {});
    const runtime = createStagehandRuntime({
      browserSessionFactory: () =>
        new Promise((resolve) => {
          finish = () => resolve(createBrowserSession({ close }));
        }),
    });

    const connecting = runtime.ensureBrowserConnection("ws://browser.example");
    await vi.waitFor(() => expect(finish).toBeDefined());
    await runtime.disconnectBrowser();
    finish();

    await expect(connecting).rejects.toThrow("dropped while connecting");
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.browserSession).toBeUndefined();
  });
});

describe("runtime domain policy disposal", () => {
  it("does not reopen requests when runtime close is followed by queued instance disposal", async () => {
    const gate = Promise.withResolvers<void>();
    const cleanup = vi.fn(() => gate.promise);
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession({ close: cleanup }),
    });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    const release = runtime.acquireStagehandInstanceRequest();
    const closing = runtime.close();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    const disposing = runtime.disposeStagehandInstance();
    gate.resolve();
    await closing;
    expect(() => runtime.acquireStagehandInstanceRequest()).toThrow("closing");
    release();
    await disposing;
    runtime.acquireStagehandInstanceRequest()();
  });

  it("can recover failed instance disposal by successfully closing the runtime", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () =>
        createBrowserSession({
          getDomainPolicy: () => ({ blockedDomains: ["blocked.test"] }),
          setDomainPolicy: async () => {
            throw new Error("cleanup failed");
          },
        }),
    });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    await expect(runtime.disposeStagehandInstance()).rejects.toThrow("cleanup failed");
    expect(() => runtime.acquireStagehandInstanceRequest()).toThrow("closing");
    await runtime.close();
    expect(runtime.browserSession).toBeUndefined();
    expect(runtime.state.getState().status).toBe("idle");
    runtime.acquireStagehandInstanceRequest()();
  });

  it("cannot complete disposal while detached-session cleanup is still failing", async () => {
    let rulesInstalled = true;
    const cleanup = vi
      .fn(async () => {
        rulesInstalled = false;
      })
      .mockRejectedValueOnce(new Error("cleanup failed"))
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => createBrowserSession({ close: cleanup }),
    });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    await expect(runtime.disconnectBrowser()).rejects.toThrow("cleanup failed");
    await expect(runtime.disposeStagehandInstance()).rejects.toThrow("cleanup failed");
    expect(rulesInstalled).toBe(true);
    expect(() => runtime.acquireStagehandInstanceRequest()).toThrow("closing");
    await runtime.disposeStagehandInstance();
    expect(rulesInstalled).toBe(false);
    expect(runtime.state.getState().status).toBe("idle");
    runtime.acquireStagehandInstanceRequest()();
  });
  it("clears policy before allowing reuse of the retained browser session", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const setDomainPolicy = vi.fn(async () => {
      started.resolve();
      await gate.promise;
    });
    const close = vi.fn();
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () =>
        createBrowserSession({
          getDomainPolicy: () => ({ blockedDomains: ["blocked.test"] }),
          setDomainPolicy,
          close,
        }),
    });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    const disposing = runtime.disposeStagehandInstance();
    await started.promise;
    const initializing = runtime.initialize(runtimeIdentity);
    expect(runtime.state.getState().status).toBe("initialized");
    expect(setDomainPolicy).toHaveBeenCalledWith(null);
    gate.resolve();
    await disposing;
    await initializing;
    expect(close).not.toHaveBeenCalled();
  });

  it("reports policy cleanup failure without pretending disposal completed, and permits retry", async () => {
    const setDomainPolicy = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("cleanup failed"));
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () =>
        createBrowserSession({
          getDomainPolicy: () => ({ blockedDomains: ["blocked.test"] }),
          setDomainPolicy,
        }),
    });
    await runtime.initialize({ ...runtimeIdentity, browserCdpUrl: "ws://browser.example" });
    await expect(runtime.disposeStagehandInstance()).rejects.toThrow("cleanup failed");
    expect(runtime.state.getState().status).toBe("initialized");
    expect(() => runtime.acquireStagehandInstanceRequest()).toThrow("closing");
    await runtime.disposeStagehandInstance();
    expect(runtime.state.getState().status).toBe("idle");
    runtime.acquireStagehandInstanceRequest()();
    expect(setDomainPolicy).toHaveBeenCalledTimes(2);
  });
});
