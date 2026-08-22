import { describe, expect, it, vi } from "vitest";
import { StagehandRpcRequestSchema } from "../../protocol/schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../../protocol/schemas.js";
import { BrowserSessionUnavailableError } from "../errors.js";
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

function createSession(pages: UnderstudyRuntimePage[] = []) {
  let connected = true;
  const close = vi.fn(async () => {
    connected = false;
  });
  const session = {
    get connected() {
      return connected;
    },
    pages: () => pages,
    close,
  } as unknown as StagehandBrowserSession;
  return {
    session,
    close,
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

function request(method: string, params: Record<string, unknown> = {}) {
  return StagehandRpcRequestSchema.parse({ jsonrpc: "2.0", id: 1, method, params });
}

describe("browser session waiting", () => {
  it("an RPC issued mid-replacement waits for the new session", async () => {
    const created = deferred<StagehandBrowserSession>();
    const page = {
      targetId: () => "page-a",
      url: () => "https://example.com/",
    } as unknown as UnderstudyRuntimePage;
    const { session } = createSession([page]);
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => await created.promise,
    });
    const router = new RPCRouter(runtime);

    const replacement = runtime.replaceBrowserConnection({ cdpUrl: RESIDENT_TEST_URL });
    let settled = false;
    const routed = router.handle(request("context.pages")).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    created.resolve(session);
    await replacement;
    await expect(routed).resolves.toStrictEqual([
      { pageId: "page-a", url: "https://example.com/" },
    ]);
  });

  it("an RPC gives up with a structured error when the replacement never lands", async () => {
    const runtime = createStagehandRuntime({
      browserSessionFactory: async () => await new Promise<StagehandBrowserSession>(() => {}),
    });
    void runtime.replaceBrowserConnection({ cdpUrl: RESIDENT_TEST_URL });

    const unavailable = runtime.waitForBrowserSession(20);
    await expect(unavailable).rejects.toBeInstanceOf(BrowserSessionUnavailableError);
    await expect(unavailable).rejects.toThrow("STAGEHAND_BROWSER_SESSION_UNAVAILABLE");

    const error = new BrowserSessionUnavailableError(20);
    vi.spyOn(runtime, "waitForBrowserSession").mockRejectedValue(error);
    const router = new RPCRouter(runtime);
    await expect(router.handle(request("context.pages"))).rejects.toBe(error);
  });

  it("stagehand.init and stagehand.close are not gated", async () => {
    const runtime = createStagehandRuntime();
    const waitForBrowserSession = vi
      .spyOn(runtime, "waitForBrowserSession")
      .mockResolvedValue(undefined);
    vi.spyOn(runtime, "contextPages").mockResolvedValue([]);
    const initializeStagehand = vi.fn(async () => ({ initialized: true as const, pages: [] }));
    const closeStagehand = vi.fn(async () => {});
    const router = new RPCRouter(runtime, { initializeStagehand, closeStagehand });

    await router.handle(
      StagehandRpcRequestSchema.parse({
        jsonrpc: "2.0",
        id: 1,
        method: "stagehand.init",
        params: {
          protocol_version: STAGEHAND_PROTOCOL_VERSION,
          client_info: { name: "stagehand-sdk-ts", version: "4.0.0" },
          log_level: "info",
        },
      }),
    );
    expect(waitForBrowserSession).not.toHaveBeenCalled();

    await router.handle(request("context.pages"));
    expect(waitForBrowserSession).toHaveBeenCalledOnce();

    waitForBrowserSession.mockClear();
    await router.handle(request("stagehand.close"));
    expect(waitForBrowserSession).not.toHaveBeenCalled();
  });

  it("a scheduled resident reconnect keeps an RPC waiting until it lands", async () => {
    const first = createSession();
    const second = createSession();
    const reconnected = deferred<StagehandBrowserSession>();
    let attempt = 0;
    const browserSessionFactory = vi.fn(
      connectedFactory(async () => {
        attempt += 1;
        return attempt === 1 ? first.session : await reconnected.promise;
      }),
    );
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [10] }),
    );

    await lifecycle.bootstrap();
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    await vi.waitFor(() => expect(browserSessionFactory).toHaveBeenCalledTimes(2));

    let settled = false;
    const waiting = runtime.waitForBrowserSession(5_000).then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    reconnected.resolve(second.session);
    await waiting;
    expect(runtime.browserConnectionStatus()).toStrictEqual({
      configured: true,
      connected: true,
    });
  });

  it("an RPC waits across a reconnect that has only been scheduled", async () => {
    const first = createSession();
    const second = createSession();
    const sessions = [first.session, second.session];
    const browserSessionFactory = vi.fn(connectedFactory(async () => sessions.shift()!));
    const runtime = createStagehandRuntime({ browserSessionFactory });
    const hooks = captureHooks(runtime);
    const lifecycle = new ResidentRuntimeLifecycle(
      runtime,
      residentOptions({ reconnectDelaysMs: [50] }),
    );

    await lifecycle.bootstrap();
    // The socket drops and the lifecycle only arms a timer: the stale session is still installed,
    // so the wait has to follow the schedule rather than fail fast on a disconnected session.
    first.disconnect();
    hooks[0]?.lifecycle?.onDisconnected?.();
    expect(runtime.browserConnectionStatus()).toStrictEqual({ configured: true, connected: false });
    expect(browserSessionFactory).toHaveBeenCalledOnce();

    await runtime.waitForBrowserSession(5_000);

    expect(browserSessionFactory).toHaveBeenCalledTimes(2);
    expect(runtime.browserConnectionStatus()).toStrictEqual({ configured: true, connected: true });
    await lifecycle.close();
  });
});
