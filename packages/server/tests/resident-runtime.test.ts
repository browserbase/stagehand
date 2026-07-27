import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import type { StagehandBrowserSession, StagehandBrowserSessionFactory } from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";
import { RPCRouter } from "../rpcRouter.js";
import {
  ResidentRuntimeLifecycle,
  type ResidentRuntimeLifecycleOptions,
} from "../service-worker-lifecycle/resident-runtime.js";

const RESIDENT_TEST_URL = "ws://browser-proxy.test/devtools/browser/session";

const initParams = {
  protocolVersion: 4 as const,
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

function createSession() {
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
    pages: () => [],
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
        runtimeInstanceId: "worker-a",
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
      runtimeInstanceId: "worker-a",
      timings: {
        connectAndBootstrapMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
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

  it("re-resolves and restores initialized instrumentation after socket loss", async () => {
    const first = createSession();
    const second = createSession();
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
