import { describe, expect, it, vi } from "vite-plus/test";
import type {
  StagehandBrowserSession,
  StagehandBrowserSessionFactory,
  UnderstudyRuntimePage,
} from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";
import { RPCRouter } from "../rpcRouter.js";
import { ResidentRuntimeLifecycle } from "../service-worker-lifecycle/resident-runtime.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createSession(page?: UnderstudyRuntimePage) {
  const close = vi.fn(async () => {});
  const session = {
    connected: true,
    pages: () => (page ? [page] : []),
    close,
  } as unknown as StagehandBrowserSession;
  return { session, close };
}

describe("resident runtime lifecycle", () => {
  it("passes the exact resolved URL to one coalesced connection and waits for bootstrap", async () => {
    const created = deferred<StagehandBrowserSession>();
    const { session } = createSession();
    const browserSessionFactory: StagehandBrowserSessionFactory = vi.fn(
      async (_cdpUrl, _logger, lifecycle) => {
        lifecycle?.onConnecting?.();
        lifecycle?.onConnected?.();
        return await created.promise;
      },
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () => "ws://127.0.0.1:9222/devtools/browser/exact-resident-session",
    });

    const first = lifecycle.bootstrap();
    const second = lifecycle.bootstrap();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    expect(lifecycle.marker.connected).toBe(true);
    expect(lifecycle.marker.state).not.toBe("ready");

    created.resolve(session);
    await first;

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://127.0.0.1:9222/devtools/browser/exact-resident-session",
      runtime.logger,
      expect.any(Object),
    );
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });
    expect(lifecycle.marker.timings).toEqual({
      resolveMs: expect.any(Number),
      connectAndBootstrapMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
  });

  it("reset closes the old session and clears page and initialization state", async () => {
    const page = {
      targetId: () => "page-before-reset",
      url: () => "about:blank",
    } as unknown as UnderstudyRuntimePage;
    const first = createSession(page);
    const second = createSession();
    const sessions = [first.session, second.session];
    let firstLifecycle: Parameters<StagehandBrowserSessionFactory>[2];
    const runtime = createStagehandRuntime({
      browserSessionFactory: async (_url, _logger, lifecycle) => {
        firstLifecycle ??= lifecycle;
        return sessions.shift()!;
      },
    });
    first.close.mockImplementation(async () => firstLifecycle?.onDisconnected?.());
    let resolution = 0;
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () =>
        `ws://127.0.0.1:9222/devtools/browser/session-${++resolution}`,
    });

    await lifecycle.bootstrap();
    await runtime.initialize({
      model: { modelName: "openai/gpt-5" },
      telemetry: { traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} } },
    });
    expect(runtime.pagesById.has("page-before-reset")).toBe(true);

    await lifecycle.reset();

    expect(first.close).toHaveBeenCalledOnce();
    expect(runtime.pagesById.size).toBe(0);
    expect(runtime.state.getState()).toStrictEqual({ status: "created" });
    await expect(
      new RPCRouter(runtime).handle({
        jsonrpc: "2.0",
        id: 1,
        method: "stagehand.init",
        params: {},
      }),
    ).resolves.toMatchObject({ initialized: true });
    expect(lifecycle.marker.state).toBe("ready");
    expect(resolution).toBe(2);
  });

  it("invalidates readiness when the active CDP transport disconnects", async () => {
    const { session } = createSession();
    let sessionLifecycle: Parameters<StagehandBrowserSessionFactory>[2];
    const runtime = createStagehandRuntime({
      browserSessionFactory: async (_url, _logger, lifecycle) => {
        sessionLifecycle = lifecycle;
        return session;
      },
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () => "ws://127.0.0.1:9222/devtools/browser/disconnect",
    });

    await lifecycle.bootstrap();
    expect(lifecycle.marker).toMatchObject({ state: "ready", connected: true });

    sessionLifecycle?.onDisconnected?.();

    expect(lifecycle.marker).toMatchObject({ state: "disconnected", connected: false });
  });

  it("does not publish ready if CDP disconnects as bootstrap completes", async () => {
    const disconnected = createSession();
    Object.defineProperty(disconnected.session, "connected", { value: false });
    const runtime = createStagehandRuntime({
      browserSessionFactory: async (_url, _logger, lifecycle) => {
        lifecycle?.onDisconnected?.();
        return disconnected.session;
      },
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () => "ws://127.0.0.1:9222/devtools/browser/disconnected",
    });

    await expect(lifecycle.bootstrap()).rejects.toThrow(
      "Resident runtime disconnected during bootstrap",
    );

    expect(disconnected.close).toHaveBeenCalledOnce();
    expect(runtime.loopbackStatus()).toStrictEqual({ configured: false, connected: false });
    expect(lifecycle.marker).toMatchObject({ state: "disconnected", connected: false });
  });

  it("does not let a stale bootstrap generation overwrite a reset", async () => {
    const firstCreated = deferred<StagehandBrowserSession>();
    const secondCreated = deferred<StagehandBrowserSession>();
    const first = createSession();
    const second = createSession();
    let factoryCall = 0;
    const runtime = createStagehandRuntime({
      browserSessionFactory: async (_url, _logger, lifecycle) => {
        lifecycle?.onConnecting?.();
        lifecycle?.onConnected?.();
        factoryCall += 1;
        return await (factoryCall === 1 ? firstCreated.promise : secondCreated.promise);
      },
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () =>
        `ws://127.0.0.1:9222/devtools/browser/generation-${factoryCall + 1}`,
    });

    const staleBootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(factoryCall).toBe(1));
    const reset = lifecycle.reset();
    firstCreated.resolve(first.session);
    await staleBootstrap;
    await vi.waitFor(() => expect(factoryCall).toBe(2));
    expect(lifecycle.marker.state).not.toBe("ready");

    secondCreated.resolve(second.session);
    await reset;

    expect(first.close).toHaveBeenCalledOnce();
    expect(runtime.browserSession).toBe(second.session);
    expect(lifecycle.marker.state).toBe("ready");
  });

  it("lets runtime.configure supersede an unresolved resident bootstrap", async () => {
    const resolvedDebuggerUrl = deferred<string>();
    const resident = createSession();
    const configured = createSession();
    const browserSessionFactory: StagehandBrowserSessionFactory = vi.fn(async (cdpUrl) =>
      cdpUrl.includes("configured") ? configured.session : resident.session,
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveDebuggerUrl: async () => await resolvedDebuggerUrl.promise,
    });
    const router = new RPCRouter(runtime, {
      beforeRuntimeConfigure: () => lifecycle.disableAutoBootstrap(),
    });

    const bootstrap = lifecycle.bootstrap();
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("resolving-cdp"));
    await router.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "runtime.configure",
      params: {
        cdpUrl: "ws://127.0.0.1:9333/devtools/browser/configured",
        telemetry: {
          traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} },
        },
      },
    });
    resolvedDebuggerUrl.resolve("ws://127.0.0.1:9222/devtools/browser/resident");
    await bootstrap;

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://127.0.0.1:9333/devtools/browser/configured",
      runtime.logger,
      undefined,
    );
    expect(runtime.browserSession).toBe(configured.session);
    expect(resident.close).not.toHaveBeenCalled();
    expect(lifecycle.marker).toMatchObject({ state: "disconnected", connected: false });
  });
});
