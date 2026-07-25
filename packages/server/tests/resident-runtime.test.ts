import { describe, expect, it, vi } from "vite-plus/test";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import type {
  StagehandBrowserSession,
  StagehandBrowserSessionFactory,
  UnderstudyRuntimePage,
} from "../runtime.js";
import { createStagehandRuntime } from "../runtime.js";
import { RPCRouter } from "../rpcRouter.js";
import {
  STAGEHAND_PID2_WEBSOCKET_URL,
  StagehandPid2InactiveError,
} from "../service-worker-lifecycle/pid2-transport.js";
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

function residentFactory(
  create: (url: string) => Promise<StagehandBrowserSession>,
  activationEpoch = "reservation-a",
): StagehandBrowserSessionFactory {
  return async (url, _logger, lifecycle) => {
    await lifecycle?.onActivation?.(activationEpoch);
    lifecycle?.onConnected?.();
    return await create(url);
  };
}

const initParams = {
  protocolVersion: 4 as const,
  clientInfo: { name: "stagehand-sdk-ts", version: "4.0.0" },
  telemetry: {
    traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} },
  },
};

describe("resident runtime lifecycle", () => {
  it("coalesces startup and waits for both V3Context bootstrap and the RPC receiver", async () => {
    const created = deferred<StagehandBrowserSession>();
    const receiverReady = deferred<void>();
    const { session } = createSession();
    const browserSessionFactory = vi.fn(residentFactory(async () => await created.promise));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      waitForRpcReceiver: () => receiverReady.promise,
      runtimeInstanceId: "worker-a",
    });

    const first = lifecycle.bootstrap();
    const second = lifecycle.bootstrap();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(lifecycle.marker.state).toBe("bootstrapping"));
    expect(lifecycle.marker.connected).toBe(true);
    expect(lifecycle.marker.state).not.toBe("ready");

    created.resolve(session);
    await Promise.resolve();
    expect(lifecycle.marker.state).toBe("bootstrapping");
    receiverReady.resolve();
    await first;

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      STAGEHAND_PID2_WEBSOCKET_URL,
      runtime.logger,
      expect.any(Object),
    );
    expect(lifecycle.marker).toMatchObject({
      name: "stagehand",
      version: "4.0.0",
      state: "ready",
      connected: true,
      activationEpoch: "reservation-a",
      runtimeInstanceId: "worker-a",
      timings: {
        connectAndBootstrapMs: expect.any(Number),
        totalMs: expect.any(Number),
      },
    });
  });

  it("allows stagehand.init without a CDP URL only after resident readiness", async () => {
    const { session } = createSession();
    const runtime = createStagehandRuntime({
      browserSessionFactory: residentFactory(async () => session),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime);

    await expect(lifecycle.initialize(initParams)).rejects.toThrow("Resident runtime is not ready");
    await lifecycle.bootstrap();
    await expect(lifecycle.initialize(initParams)).resolves.toMatchObject({ initialized: true });
    expect(runtime.state.getState().status).toBe("initialized");
  });

  it("becomes inactive without a browser session when pid2 rejects activation", async () => {
    const onInactive = vi.fn();
    const browserSessionFactory = vi.fn(async () => {
      throw new StagehandPid2InactiveError();
    });
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, { onInactive });

    await lifecycle.bootstrap();

    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(runtime.loopbackStatus()).toStrictEqual({ configured: false, connected: false });
    expect(lifecycle.marker).toMatchObject({ state: "inactive", connected: false });
    expect(lifecycle.marker.activationEpoch).toBeUndefined();
    expect(onInactive).toHaveBeenCalledOnce();
  });

  it("reset closes the old session, clears reservation state, and permits init again", async () => {
    const page = {
      targetId: () => "page-before-reset",
      url: () => "about:blank",
    } as unknown as UnderstudyRuntimePage;
    const first = createSession(page);
    const second = createSession();
    const sessions = [first.session, second.session];
    const runtime = createStagehandRuntime({
      browserSessionFactory: residentFactory(async () => sessions.shift()!),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime);

    await lifecycle.bootstrap();
    await lifecycle.initialize({
      ...initParams,
      model: { modelName: "openai/gpt-5" },
      telemetry: { traces: { endpoint: "http://127.0.0.1:4318/v1/traces", headers: {} } },
    });
    expect(runtime.pagesById.has("page-before-reset")).toBe(true);

    await lifecycle.reset();

    expect(first.close).toHaveBeenCalledOnce();
    expect(runtime.pagesById.size).toBe(0);
    expect(runtime.state.getState()).toStrictEqual({ status: "created" });
    await expect(
      new RPCRouter(runtime, {
        initializeStagehand: (params) => lifecycle.initialize(params),
      }).handle(
        StagehandRpcRequestSchema.parse({
          jsonrpc: "2.0",
          id: 1,
          method: "stagehand.init",
          params: {
            protocol_version: 4,
            client_info: { name: "stagehand-sdk-ts", version: "4.0.0" },
          },
        }),
      ),
    ).resolves.toMatchObject({ initialized: true });
    expect(lifecycle.marker.state).toBe("ready");
  });

  it("leaves ready immediately and schedules one bounded reconnect after socket loss", async () => {
    const first = createSession();
    let sessionLifecycle: Parameters<StagehandBrowserSessionFactory>[2];
    const runtime = createStagehandRuntime({
      browserSessionFactory: residentFactory(async (_url) => {
        return first.session;
      }),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      reconnectDelaysMs: [60_000],
    });
    const originalFactory = runtime.adapters.browserSessionFactory;
    runtime.adapters.browserSessionFactory = async (url, logger, hooks) => {
      sessionLifecycle = hooks;
      return await originalFactory(url, logger, hooks);
    };

    await lifecycle.bootstrap();
    expect(lifecycle.marker.state).toBe("ready");
    sessionLifecycle?.onDisconnected?.();

    expect(lifecycle.marker).toMatchObject({ state: "reconnecting", connected: false });
    await lifecycle.initialize({
      ...initParams,
      browserCdpUrl: "ws://127.0.0.1:9333/devtools/browser/local",
    });
  });

  it("does not let a stale resident bootstrap overwrite a reset", async () => {
    const firstCreated = deferred<StagehandBrowserSession>();
    const secondCreated = deferred<StagehandBrowserSession>();
    const first = createSession();
    const second = createSession();
    let factoryCall = 0;
    const runtime = createStagehandRuntime({
      browserSessionFactory: residentFactory(async () => {
        factoryCall += 1;
        return await (factoryCall === 1 ? firstCreated.promise : secondCreated.promise);
      }),
    });
    const lifecycle = new ResidentRuntimeLifecycle(runtime);

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

  it("preserves local/custom CDP initialization and supersedes resident startup", async () => {
    const resolvedResidentUrl = deferred<string>();
    const configured = createSession();
    const browserSessionFactory = vi.fn(async () => configured.session);
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const lifecycle = new ResidentRuntimeLifecycle(runtime, {
      resolveResidentWebSocketUrl: async () => await resolvedResidentUrl.promise,
    });

    const residentBootstrap = lifecycle.bootstrap();
    const initialization = lifecycle.initialize({
      ...initParams,
      browserCdpUrl: "ws://127.0.0.1:9333/devtools/browser/configured",
    });
    resolvedResidentUrl.resolve(STAGEHAND_PID2_WEBSOCKET_URL);

    await residentBootstrap;
    await expect(initialization).resolves.toMatchObject({ initialized: true });
    expect(browserSessionFactory).toHaveBeenCalledOnce();
    expect(browserSessionFactory).toHaveBeenCalledWith(
      "ws://127.0.0.1:9333/devtools/browser/configured",
      runtime.logger,
      expect.any(Object),
    );
  });
});
