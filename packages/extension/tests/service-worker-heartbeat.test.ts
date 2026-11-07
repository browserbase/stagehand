import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServiceWorkerHeartbeatManager,
  STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT,
  type ServiceWorkerHeartbeatChrome,
} from "../service-worker-lifecycle/heartbeat-manager.ts";

function createChromeApi(overrides: {
  createDocument?: () => Promise<void>;
  getContexts?: () => Promise<unknown[]>;
}) {
  const createDocument = vi.fn(overrides.createDocument ?? (async () => {}));
  const getContexts = vi.fn(overrides.getContexts ?? (async () => []));
  const chromeApi: ServiceWorkerHeartbeatChrome = {
    offscreen: {
      createDocument,
    },
    runtime: {
      getContexts,
      getURL: (path) => `chrome-extension://stagehand/${path}`,
      onConnect: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
    },
    tabs: {
      onCreated: { addListener: vi.fn() },
    },
  };
  return { chromeApi, createDocument, getContexts };
}

describe("service worker heartbeat manager", () => {
  it("reuses an offscreen document that survived a service-worker restart", async () => {
    const { chromeApi, createDocument, getContexts } = createChromeApi({
      getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
    });

    await createServiceWorkerHeartbeatManager(chromeApi).ensure();

    expect(getContexts).toHaveBeenCalledWith({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: ["chrome-extension://stagehand/offscreen/service-worker-heartbeat.html"],
    });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("serializes concurrent wake events into one document creation", async () => {
    let finishCreation: (() => void) | undefined;
    const createDocument = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCreation = resolve;
        }),
    );
    const { chromeApi } = createChromeApi({ createDocument });
    const manager = createServiceWorkerHeartbeatManager(chromeApi);

    const startupEnsure = manager.ensure();
    const tabEnsure = manager.ensure();
    await Promise.resolve();

    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith({
      url: "offscreen/service-worker-heartbeat.html",
      reasons: ["BLOBS"],
      justification: "Maintain service worker liveness for long-running sessions.",
    });

    finishCreation?.();
    await Promise.all([startupEnsure, tabEnsure]);
  });
});

describe("service worker heartbeat offscreen script", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends a heartbeat immediately and then every 20 seconds", async () => {
    vi.useFakeTimers();
    const message = vi.fn();
    const connect = vi.fn(() => ({
      onDisconnect: { addListener: vi.fn() },
      postMessage: message,
    }));
    vi.stubGlobal("chrome", { runtime: { connect } });

    await import("../service-worker-lifecycle/heartbeat.ts");

    expect(connect).toHaveBeenCalledWith({ name: STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT });
    expect(message).toHaveBeenCalledOnce();
    expect(message.mock.calls[0]?.[0]).toMatchObject({
      type: STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT,
    });

    await vi.advanceTimersByTimeAsync(19_999);
    expect(message).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(message).toHaveBeenCalledTimes(2);
  });

  it("reconnects 250 ms after disconnection and sends a heartbeat immediately", async () => {
    vi.useFakeTimers();
    const disconnectListeners: Array<() => void> = [];
    const message = vi.fn();
    const connect = vi.fn(() => ({
      onDisconnect: {
        addListener: (listener: () => void) => {
          disconnectListeners.push(listener);
        },
      },
      postMessage: message,
    }));
    vi.stubGlobal("chrome", { runtime: { connect } });

    await import("../service-worker-lifecycle/heartbeat.ts");
    message.mockClear();

    disconnectListeners[0]?.();
    await vi.advanceTimersByTimeAsync(249);
    expect(connect).toHaveBeenCalledOnce();
    expect(message).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(message).toHaveBeenCalledOnce();
  });
});
