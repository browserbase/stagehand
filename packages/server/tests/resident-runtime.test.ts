import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import type {
  StagehandBrowserSession,
  StagehandBrowserSessionFactory,
  UnderstudyRuntimePage,
} from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";
import { RPCRouter } from "../rpcRouter.js";
import {
  ResidentRuntimeLifecycle,
  type ResidentRuntimeLifecycleOptions,
} from "../service-worker-lifecycle/resident-runtime.js";

const RESIDENT_TEST_URL = "ws://browser-proxy.test/devtools/browser/session";

const initParams = {
  protocolVersion: STAGEHAND_PROTOCOL_VERSION,
  clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
  logLevel: "info" as const,
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
  const page = {
    targetId: () => targetId,
    url: () => "https://example.com/",
    addInitScript,
    setExtraHTTPHeaders,
    setViewportSize,
  } as unknown as UnderstudyRuntimePage;
  return { page, addInitScript, setExtraHTTPHeaders, setViewportSize };
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
  return async (url, _logger, lifecycle) => {
    lifecycle?.onConnected?.();
    return await create(url);
  };
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

  it("coalesces startup and waits for V3Context bootstrap and the RPC receiver", async () => {
    const created = deferred<StagehandBrowserSession>();
    const receiverReady = deferred<void>();
    const { session } = createSession();
    const browserSessionFactory = vi.fn(connectedFactory(async () => await created.promise));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({
        waitForRpcReceiver: () => receiverReady.promise,
      }),
    );

    const first = lifecycle.bootstrap();
    const second = lifecycle.bootstrap();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    expect(lifecycle.marker.connected).toBe(true);

    created.resolve(session);
    await Promise.resolve();
    expect(lifecycle.marker.state).toBe("bootstrapping");
    receiverReady.resolve();
    await first;

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      RESIDENT_TEST_URL,
      runtime.logger,
      expect.objectContaining({ bootstrapMode: "resident" }),
    );
    expect(lifecycle.marker).toMatchObject({
      state: "ready",
      connected: true,
      timings: {
        connectAndBootstrapMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });
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
      residentOptions({
        now: () => now,
        resolveResidentWebSocketUrl: () => residentUrl.promise,
      }),
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
    expect(runtime.state.getState().status).toBe("created");

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
      undefined,
    );
    expect(lifecycle.marker).toMatchObject({ state: "unconfigured", connected: false });
    expect(runtime.state.getState().status).toBe("initialized");
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

    expect(current.close).toHaveBeenCalledOnce();
    expect(lifecycle.marker).toMatchObject({ state: "closed", connected: false });
    receiverReady.resolve();
    await expect(bootstrap).rejects.toThrow("superseded");
  });

  it("re-resolves and restores initialized instrumentation after socket loss", async () => {
    const firstPage = createPage("page-a");
    const secondPage = createPage("page-a");
    const first = createSession([firstPage.page]);
    const second = createSession([secondPage.page]);
    const sessions = [first.session, second.session];
    const hooks: Array<Parameters<StagehandBrowserSessionFactory>[2]> = [];
    const resolveResidentWebSocketUrl = vi.fn(async () => RESIDENT_TEST_URL);
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => sessions.shift()!),
    });
    const originalFactory = runtime.adapters.browserSessionFactory;
    runtime.adapters.browserSessionFactory = async (url, logger, lifecycle) => {
      hooks.push(lifecycle);
      return await originalFactory(url, logger, lifecycle);
    };
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ resolveResidentWebSocketUrl, reconnectDelaysMs: [0] }),
    );

    await lifecycle.bootstrap();
    await lifecycle.initialize(initParams);
    await runtime.contextAddInitScript({ source: "globalThis.__resident = true" });
    await runtime.contextSetExtraHTTPHeaders({ headers: { "x-stagehand": "resident" } });
    await runtime.contextSetDomainPolicy({ policy: { allowedDomains: ["example.com"] } });
    await runtime.pageAddInitScript({
      pageId: "page-a",
      source: "globalThis.__pageResident = true",
    });
    await runtime.pageSetExtraHTTPHeaders({
      pageId: "page-a",
      headers: { "x-stagehand-page": "resident" },
    });
    await runtime.pageSetViewportSize({ pageId: "page-a", width: 800, height: 600 });

    const restored = deferred<void>();
    second.prepareForInitialization.mockImplementation(async () => await restored.promise);
    first.disconnect();
    hooks[0]?.onDisconnected?.();
    expect(lifecycle.marker).toMatchObject({ state: "reconnecting", connected: false });
    await vi.waitFor(() => expect(hooks).toHaveLength(2));
    expect(lifecycle.marker).toMatchObject({ state: "bootstrapping", connected: true });

    restored.resolve();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("ready"));
    expect(resolveResidentWebSocketUrl).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.addInitScript).toHaveBeenCalledWith("globalThis.__resident = true");
    expect(second.setExtraHTTPHeaders).toHaveBeenCalledWith({ "x-stagehand": "resident" });
    expect(second.setDomainPolicy).toHaveBeenCalledWith({ allowedDomains: ["example.com"] });
    expect(secondPage.addInitScript).toHaveBeenCalledWith("globalThis.__pageResident = true");
    expect(secondPage.setExtraHTTPHeaders).toHaveBeenCalledWith({
      "x-stagehand-page": "resident",
    });
    expect(secondPage.setViewportSize).toHaveBeenCalledWith(800, 600, undefined);
    expect(runtime.state.getState().status).toBe("initialized");
  });

  it("does not publish ready after disconnecting while the receiver is pending", async () => {
    const receiverReady = deferred<void>();
    const current = createSession();
    let hooks: Parameters<StagehandBrowserSessionFactory>[2];
    const runtime = createStagehandRuntime({
      browserSessionFactory: connectedFactory(async () => current.session),
    });
    const originalFactory = runtime.adapters.browserSessionFactory;
    runtime.adapters.browserSessionFactory = async (url, logger, lifecycle) => {
      hooks = lifecycle;
      return await originalFactory(url, logger, lifecycle);
    };
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
    hooks?.onDisconnected?.();
    receiverReady.resolve();
    await expect(bootstrap).rejects.toThrow("disconnected");
    expect(lifecycle.marker).toMatchObject({ state: "reconnecting", connected: false });
    await lifecycle.close();
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
      connected: false,
      failure: { phase: "connecting", message: "Resident runtime connecting failed" },
    });
    expect(JSON.stringify(lifecycle.marker)).not.toContain("private.internal");
  });

  it("preserves the reconnect failure phase when the retry budget is exhausted", async () => {
    const first = createSession();
    let attempts = 0;
    let hooks: Parameters<StagehandBrowserSessionFactory>[2];
    const browserSessionFactory = vi.fn(
      connectedFactory(async () => {
        attempts += 1;
        if (attempts === 1) return first.session;
        throw new Error("replacement failed");
      }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const originalFactory = runtime.adapters.browserSessionFactory;
    runtime.adapters.browserSessionFactory = async (url, logger, lifecycle) => {
      hooks = lifecycle;
      return await originalFactory(url, logger, lifecycle);
    };
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.bootstrap();
    first.disconnect();
    hooks?.onDisconnected?.();
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
    let hooks: Parameters<StagehandBrowserSessionFactory>[2];
    const browserSessionFactory = vi.fn(connectedFactory(async () => current.session));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const originalFactory = runtime.adapters.browserSessionFactory;
    runtime.adapters.browserSessionFactory = async (url, logger, lifecycle) => {
      hooks = lifecycle;
      return await originalFactory(url, logger, lifecycle);
    };
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [0] }),
    );

    await lifecycle.bootstrap();
    await lifecycle.close();
    hooks?.onDisconnected?.();
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
});
