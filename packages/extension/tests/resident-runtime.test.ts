import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type { PageCDPEvent, StagehandInitParams } from "../../protocol/types.js";
import { RPCRouter } from "../rpcRouter.js";
import {
  createStagehandRuntime,
  type StagehandBrowserSession,
  type StagehandBrowserSessionFactory,
  type StagehandBrowserSessionOptions,
  type UnderstudyRuntimePage,
} from "../runtime.js";
import {
  ResidentRuntimeLifecycle,
  type ResidentRuntimeLifecycleOptions,
} from "../service-worker-lifecycle/resident-runtime.js";

const RESIDENT_TEST_URL = "ws://browser-proxy.test/devtools/browser/session";

const initParams: StagehandInitParams = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
  logLevel: "info",
  telemetry: {
    traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} },
  },
};

function residentOptions(
  options: ResidentRuntimeLifecycleOptions = {},
): ResidentRuntimeLifecycleOptions {
  return {
    resolveResidentWebSocketUrl: async () => RESIDENT_TEST_URL,
    reconnectDelaysMs: [],
    ...options,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPage(targetId: string) {
  const addInitScript = vi.fn(async () => {});
  const setExtraHTTPHeaders = vi.fn(async () => {});
  const setViewportSize = vi.fn(async () => {});
  let eventListener: ((event: PageCDPEvent) => void) | undefined;
  const subscribeCDPEvent = vi.fn((listener: (event: PageCDPEvent) => void) => {
    eventListener = listener;
    return () => {
      eventListener = undefined;
    };
  });
  const page = {
    targetId: () => targetId,
    url: () => "https://example.com/",
    addInitScript,
    setExtraHTTPHeaders,
    setViewportSize,
    subscribeCDPEvent,
  } as unknown as UnderstudyRuntimePage;
  return {
    page,
    addInitScript,
    setExtraHTTPHeaders,
    setViewportSize,
    subscribeCDPEvent,
    emit: (event: PageCDPEvent) => eventListener?.(event),
  };
}

function createSession(pages: UnderstudyRuntimePage[] = []) {
  let connected = true;
  const close = vi.fn(async () => {
    connected = false;
  });
  const prepareForInitialization = vi.fn(async () => {});
  const addInitScript = vi.fn(async () => {});
  const setExtraHTTPHeaders = vi.fn(async () => {});
  const setDomainPolicy = vi.fn(async () => {});
  const session = {
    get connected() {
      return connected;
    },
    pages: () => pages,
    prepareForInitialization,
    addInitScript,
    setExtraHTTPHeaders,
    getDomainPolicy: () => null,
    setDomainPolicy,
    close,
  } as unknown as StagehandBrowserSession;
  return {
    session,
    close,
    prepareForInitialization,
    addInitScript,
    setExtraHTTPHeaders,
    setDomainPolicy,
    disconnect: () => {
      connected = false;
    },
  };
}

function connectedFactory(
  create: (url: string) => Promise<StagehandBrowserSession>,
): StagehandBrowserSessionFactory {
  return async (url, _logger, options) => {
    options?.lifecycle?.onConnected?.();
    return await create(url);
  };
}

function captureHooks(
  runtime: ReturnType<typeof createStagehandRuntime>,
): Array<StagehandBrowserSessionOptions | undefined> {
  const hooks: Array<StagehandBrowserSessionOptions | undefined> = [];
  const originalFactory = runtime.adapters.browserSessionFactory;
  runtime.adapters.browserSessionFactory = async (url, logger, options) => {
    hooks.push(options);
    return await originalFactory(url, logger, options);
  };
  return hooks;
}

describe("resident runtime lifecycle", () => {
  it("does nothing when the resident browser proxy is unconfigured", async () => {
    const browserSessionFactory = vi.fn();
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime);

    expect(lifecycle.marker).toMatchObject({ state: "unconfigured", connected: false });
    await expect(lifecycle.bootstrap()).rejects.toThrow("not configured");
    await expect(lifecycle.initialize(initParams)).rejects.toThrow("not configured");
    expect(browserSessionFactory).not.toHaveBeenCalled();
  });

  it("a failed stagehand.init clears the in-flight guard without an unhandled rejection", async () => {
    const runtime = createStagehandRuntime();
    const lifecycle = new ResidentRuntimeLifecycle(runtime);
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);

    try {
      await expect(lifecycle.initialize(initParams)).rejects.toThrow("not configured");
      await expect(lifecycle.initialize(initParams)).rejects.toThrow("not configured");
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("coalesces startup and waits for browser bootstrap and the RPC receiver", async () => {
    const created = deferred<StagehandBrowserSession>();
    const receiverReady = deferred<void>();
    const { session } = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => await created.promise));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ waitForRpcReceiver: () => receiverReady.promise }),
    );

    const first = lifecycle.bootstrap();
    const second = lifecycle.bootstrap();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    created.resolve(session);
    receiverReady.resolve();
    await first;

    expect(browserSessionFactory).toHaveBeenCalledWith(
      RESIDENT_TEST_URL,
      runtime.logger,
      expect.objectContaining({
        lifecycle: expect.objectContaining({ bootstrapMode: "resident" }),
      }),
    );
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
  });

  it("excludes configured idle time from resident activation timings", async () => {
    const residentUrl = deferred<string>();
    const { session } = createSession();
    let now = 0;
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => session),
    });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ now: () => now, resolveResidentWebSocketUrl: () => residentUrl.promise }),
    );

    now = 4_000;
    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("connecting"));
    now = 4_050;
    residentUrl.resolve(RESIDENT_TEST_URL);
    await bootstrap;

    expect(lifecycle.marker.timings).toStrictEqual({
      connectAndBootstrapMs: 50,
      totalMs: 50,
    });
  });

  it("queues the first stagehand.init behind an active resident bootstrap", async () => {
    const created = deferred<StagehandBrowserSession>();
    const { session } = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => await created.promise),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());

    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    const initialization = lifecycle.initialize(initParams);
    created.resolve(session);

    await bootstrap;
    await expect(initialization).resolves.toMatchObject({ initialized: true });
    expect(runtime.state.getState().status).toBe("initialized");
  });

  it("disables pending resident work before initializing an explicit CDP connection", async () => {
    const residentUrl = deferred<string>();
    const custom = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => custom.session));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ resolveResidentWebSocketUrl: () => residentUrl.promise }),
    );

    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("connecting"));
    await lifecycle.initializeWithBrowserCdpUrl({
      ...initParams,
      browserCdpUrl: "ws://custom-browser.test/devtools/browser/session",
    });
    residentUrl.resolve(RESIDENT_TEST_URL);
    await bootstrap;

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://custom-browser.test/devtools/browser/session",
      runtime.logger,
      expect.objectContaining({ bootstrapLogger: undefined }),
    );
    expect(lifecycle.marker).toMatchObject({ state: "unconfigured", connected: false });
  });

  it("closes without waiting for a stalled resident bootstrap", async () => {
    const receiverReady = deferred<void>();
    const current = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => current.session),
    });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ waitForRpcReceiver: () => receiverReady.promise }),
    );

    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    await lifecycle.close();
    receiverReady.resolve();

    await expect(bootstrap).rejects.toThrow("superseded");
    expect(current.close).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "closed", connected: false });
  });

  it("re-resolves and restores initialized instrumentation after socket loss", async () => {
    const firstPage = createPage("page-a");
    const secondPage = createPage("page-a");
    const first = createSession([firstPage.page]);
    const second = createSession([secondPage.page]);
    const sessions = [first.session, second.session];
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => sessions.shift()!),
    });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.initialize(initParams);
    await runtime.contextAddInitScript({ source: "globalThis.__resident = true" });
    await runtime.contextSetExtraHTTPHeaders({ headers: { "x-stagehand": "resident" } });
    await runtime.contextSetDomainPolicy({ policy: { allowedDomains: ["example.com"] } });
    await runtime.pageAddInitScript({ pageId: "page-a", source: "globalThis.__page = true" });
    await runtime.pageSetExtraHTTPHeaders({
      pageId: "page-a",
      headers: { "x-stagehand-page": "resident" },
    });
    await runtime.pageSetViewportSize({ pageId: "page-a", width: 800, height: 600 });

    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("ready"));

    expect(second.prepareForInitialization).toHaveBeenCalledOnce();
    expect(second.addInitScript).toHaveBeenCalledWith("globalThis.__resident = true");
    expect(second.setExtraHTTPHeaders).toHaveBeenCalledWith({ "x-stagehand": "resident" });
    expect(second.setDomainPolicy).toHaveBeenCalledWith({ allowedDomains: ["example.com"] });
    expect(secondPage.addInitScript).toHaveBeenCalledWith("globalThis.__page = true");
    expect(secondPage.setViewportSize).toHaveBeenCalledWith(800, 600, undefined);
  });

  it("publishes a sanitized terminal failure after the reconnect budget is exhausted", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => {
        throw new Error("failed to connect to ws://private.internal/session?secret=value");
      },
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());

    await expect(lifecycle.bootstrap()).rejects.toThrow("private.internal");
    expect(lifecycle.marker).toMatchObject({
      state: "failed",
      failure: { phase: "connecting", message: "Resident runtime connecting failed" },
    });
    expect(JSON.stringify(lifecycle.marker)).not.toContain("private.internal");
  });

  it("does not publish ready after disconnecting while the receiver is pending", async () => {
    const receiverReady = deferred<void>();
    const current = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => current.session),
    });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({
        reconnectDelaysMs: [60_000],
        waitForRpcReceiver: () => receiverReady.promise,
      }),
    );

    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    current.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    receiverReady.resolve();

    await expect(bootstrap).rejects.toThrow("disconnected");
    expect(lifecycle.marker).toMatchObject({ state: "reconnecting", connected: false });
    await lifecycle.close();
  });

  it("preserves the reconnect failure phase when the retry budget is exhausted", async () => {
    const first = createSession();
    let attempts = 0;
    const browserSessionFactory = vi.fn(
      connectedFactory(async () => {
        attempts += 1;
        if (attempts === 1) return first.session;
        throw new Error("replacement failed");
      }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.bootstrap();
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("failed"));

    expect(lifecycle.marker.failure).toStrictEqual({
      phase: "reconnecting",
      message: "Resident runtime reconnect budget exhausted",
    });
  });

  it("clears connected state and consumes a pending retry when bootstrap is retried", async () => {
    const replacement = createSession();
    let attempts = 0;
    const browserSessionFactory = vi.fn(
      connectedFactory(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("context bootstrap failed");
        return replacement.session;
      }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [60_000] }),
    );

    await expect(lifecycle.bootstrap()).rejects.toThrow("context bootstrap failed");
    expect(lifecycle.marker).toMatchObject({ state: "reconnecting", connected: false });

    await lifecycle.bootstrap();
    expect(browserSessionFactory).toHaveBeenCalledTimes(2);
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
    await lifecycle.close();
  });

  it("does not reconnect after an intentional close", async () => {
    const current = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => current.session));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.bootstrap();
    await lifecycle.close();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(current.close).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "closed", connected: false });
  });

  it("routes context.close through resident lifecycle teardown", async () => {
    const current = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => current.session),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());
    const router = new RPCRouter(runtime, { closeContext: () => lifecycle.close() });

    await lifecycle.bootstrap();
    await router.handle(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "context.close",
        params: {},
      }),
    );

    expect(current.close).toHaveBeenCalledOnce();
    expect(lifecycle.marker.state).toBe("closed");
  });

  it("second stagehand.init while ready reuses the resident session", async () => {
    const current = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => current.session));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());
    const replacementParams: StagehandInitParams = {
      ...initParams,
      model: { modelName: "openai/gpt-5" },
    };

    await lifecycle.initialize(initParams);
    await expect(lifecycle.initialize(replacementParams)).resolves.toMatchObject({
      initialized: true,
    });

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(current.prepareForInitialization).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
    expect(runtime.state.getState()).toMatchObject({
      status: "initialized",
      initParams: replacementParams,
    });
  });

  it("second stagehand.init without browserCdpUrl reattaches to a legacy session", async () => {
    const current = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => current.session));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime);
    const replacementParams: StagehandInitParams = {
      ...initParams,
      model: { modelName: "openai/gpt-5" },
    };

    await lifecycle.initializeWithBrowserCdpUrl({
      ...initParams,
      browserCdpUrl: "ws://custom.test/session",
    });
    await expect(lifecycle.initialize(replacementParams)).resolves.toMatchObject({
      initialized: true,
    });

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "unconfigured", connected: false });
    expect(runtime.state.getState()).toMatchObject({
      status: "initialized",
      initParams: { model: replacementParams.model },
    });
  });

  it("second stagehand.init while reconnecting waits for the reconnect and restores instrumentation", async () => {
    const first = createSession();
    const second = createSession();
    const sessions = [first.session, second.session];
    const browserSessionFactory = vi.fn(connectedFactory(async () => sessions.shift()!));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [60_000] }),
    );

    await lifecycle.initialize(initParams);
    await runtime.contextAddInitScript({ source: "globalThis.__reattach = true" });
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();

    await expect(
      lifecycle.initialize({ ...initParams, model: { modelName: "openai/gpt-5" } }),
    ).resolves.toMatchObject({ initialized: true });
    expect(browserSessionFactory).toHaveBeenCalledTimes(2);
    expect(second.addInitScript).toHaveBeenCalledWith("globalThis.__reattach = true");
    expect(second.prepareForInitialization).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
  });

  it("second stagehand.init after the reconnect budget is exhausted recovers", async () => {
    const first = createSession();
    const third = createSession();
    let attempt = 0;
    const browserSessionFactory = vi.fn(
      connectedFactory(async () => {
        attempt += 1;
        if (attempt === 1) return first.session;
        if (attempt === 2) throw new Error("replacement failed");
        return third.session;
      }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.initialize(initParams);
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("failed"));

    await expect(lifecycle.initialize(initParams)).resolves.toMatchObject({ initialized: true });
    expect(browserSessionFactory).toHaveBeenCalledTimes(3);
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
  });

  it("stagehand.init with browserCdpUrl after resident init ignores the URL", async () => {
    const logs: unknown[] = [];
    const current = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => current.session));
    const runtime = createStagehandRuntime({
      browserSessionFactory,
      emitLog: (log) => logs.push(log),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());

    await lifecycle.initialize(initParams);
    await expect(
      lifecycle.initializeWithBrowserCdpUrl({
        ...initParams,
        browserCdpUrl: "ws://custom.test/session",
      }),
    ).resolves.toMatchObject({ initialized: true });

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: "info",
        message: expect.stringContaining("ignored browserCdpUrl"),
      }),
    );
  });

  it("concurrent stagehand.init on the lifecycle fails while the first is pending", async () => {
    const created = deferred<StagehandBrowserSession>();
    const current = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => await created.promise),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());

    const first = lifecycle.initialize(initParams);
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    await expect(lifecycle.initialize(initParams)).rejects.toThrow("already in progress");
    created.resolve(current.session);
    await expect(first).resolves.toMatchObject({ initialized: true });
  });

  it("a new-generation reconnect is not queued behind a stalled stale restore", async () => {
    const firstPage = createPage("page-a");
    const thirdPage = createPage("page-a");
    const first = createSession([firstPage.page]);
    const second = createSession([createPage("page-a").page]);
    const third = createSession([thirdPage.page]);
    const stalled = new Promise<void>(() => {});
    second.prepareForInitialization.mockImplementation(async () => await stalled);
    const sessions = [first.session, second.session, third.session];
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => sessions.shift()!),
    });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0, 0] }),
    );

    await lifecycle.initialize(initParams);
    runtime.pageOn({ pageId: "page-a", subscriptionId: "sub-1", event: "console" });
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(hooks).toHaveLength(2));
    second.disconnect();
    hooks[1]?.lifecycle?.onDisconnected?.();

    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("ready"));
    expect(runtime.browserSession).toBe(third.session);
    // The superseded reconnect never restored, so the subscription must survive into
    // the generation that did.
    expect(thirdPage.subscribeCDPEvent).toHaveBeenCalledOnce();
  });

  it("honors page.off for a subscription that is pending restoration", async () => {
    const firstPage = createPage("page-a");
    const secondPage = createPage("page-a");
    const first = createSession([firstPage.page]);
    const second = createSession([secondPage.page]);
    const sessions = [first.session, second.session];
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => sessions.shift()!),
    });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [60_000] }),
    );

    await lifecycle.initialize(initParams);
    runtime.pageOn({ pageId: "page-a", subscriptionId: "sub-1", event: "console" });
    const restoring = deferred<void>();
    second.prepareForInitialization.mockImplementation(async () => await restoring.promise);
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    const reattach = lifecycle.initialize(initParams);
    await vi.waitFor(() => expect(second.prepareForInitialization).toHaveBeenCalledOnce());
    // The subscription now lives only in the pending-restore snapshot.
    expect(runtime.pageOff({ subscriptionId: "sub-1" })).toStrictEqual({ ok: true });
    restoring.resolve();

    await expect(reattach).resolves.toMatchObject({ initialized: true });
    expect(lifecycle.marker.state).toBe("ready");
    expect(secondPage.subscribeCDPEvent).not.toHaveBeenCalled();
  });

  it("publishes closed even when the browser session teardown fails", async () => {
    const current = createSession();
    current.close.mockImplementation(async () => {
      throw new Error("transport close failed");
    });
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => current.session),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, residentOptions());

    await lifecycle.bootstrap();
    await expect(lifecycle.close()).rejects.toThrow("transport close failed");
    expect(lifecycle.marker).toMatchObject({ state: "closed", connected: false });
    expect(runtime.state.getState()).toStrictEqual({ status: "closed" });
  });

  it("restores page CDP event subscriptions that survive a reconnect", async () => {
    const firstPage = createPage("page-a");
    const removedPage = createPage("page-gone");
    const secondPage = createPage("page-a");
    const thirdPage = createPage("page-gone");
    const first = createSession([firstPage.page, removedPage.page]);
    const second = createSession([secondPage.page]);
    const third = createSession([thirdPage.page]);
    const sessions = [first.session, second.session, third.session];
    const notifications: unknown[] = [];
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => sessions.shift()!),
      emitPageCDPEvent: (event) => notifications.push(event),
    });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0, 0] }),
    );

    await lifecycle.initialize(initParams);
    await runtime.pageAddInitScript({ pageId: "page-gone", source: "gone" });
    runtime.pageOn({ pageId: "page-a", subscriptionId: "sub-1", event: "console" });
    runtime.pageOn({ pageId: "page-gone", subscriptionId: "sub-gone", event: "console" });
    // page-gone disappears while the connection is down: the second session never reports it.
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("ready"));

    expect(secondPage.subscribeCDPEvent).toHaveBeenCalledOnce();
    secondPage.emit({
      pageId: "page-a",
      method: "Runtime.consoleAPICalled",
      params: { type: "log" },
      sessionId: "session-2",
      targetId: "page-a",
    });
    expect(notifications).toContainEqual(expect.objectContaining({ subscriptionId: "sub-1" }));
    expect(() => runtime.pageOff({ subscriptionId: "sub-gone" })).not.toThrow();

    second.disconnect();
    hooks[1]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("ready"));
    expect(thirdPage.addInitScript).not.toHaveBeenCalledWith("gone");
  });
});
