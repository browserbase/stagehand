import { describe, expect, it, vi } from "vitest";
import {
  createServiceWorkerHeartbeatManager,
  STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT,
  type RuntimePort,
  type ServiceWorkerHeartbeatChrome,
} from "../service-worker-lifecycle/heartbeat-manager.ts";

function createChromeApi(
  overrides: {
    createDocument?: () => Promise<void>;
    getContexts?: () => Promise<unknown[]>;
  } = {},
) {
  const createDocument = vi.fn(overrides.createDocument ?? (async () => {}));
  const getContexts = vi.fn(overrides.getContexts ?? (async () => []));
  let onConnectListener: ((port: RuntimePort) => void) | undefined;
  let onTabCreatedListener: (() => void) | undefined;
  const chromeApi: ServiceWorkerHeartbeatChrome = {
    offscreen: {
      createDocument,
    },
    runtime: {
      getContexts,
      getURL: (path) => `chrome-extension://stagehand/${path}`,
      onConnect: {
        addListener: (listener) => {
          onConnectListener = listener;
        },
      },
      onStartup: {
        addListener: (_listener) => {},
      },
    },
    tabs: {
      onCreated: {
        addListener: (listener) => {
          onTabCreatedListener = listener;
        },
      },
    },
  };
  return {
    chromeApi,
    createDocument,
    getContexts,
    connect(port: RuntimePort) {
      onConnectListener?.(port);
    },
    createTab() {
      onTabCreatedListener?.();
    },
  };
}

function createHeartbeatPort(onDisconnect?: (listener: () => void) => void): RuntimePort {
  return {
    name: STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT,
    onDisconnect: {
      addListener: (listener) => {
        onDisconnect?.(listener);
      },
    },
    onMessage: {
      addListener: (_listener: (message: unknown) => void) => {},
    },
  };
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

  it("skips offscreen lookups while a heartbeat port is already connected", async () => {
    const { chromeApi, createDocument, getContexts, connect, createTab } = createChromeApi({
      getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
    });
    const manager = createServiceWorkerHeartbeatManager(chromeApi);
    manager.install();
    await vi.waitFor(() => {
      expect(getContexts).toHaveBeenCalled();
    });

    connect(createHeartbeatPort());
    getContexts.mockClear();
    createDocument.mockClear();

    createTab();
    await Promise.resolve();
    await Promise.resolve();

    expect(getContexts).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("recreates the offscreen document after the heartbeat port disconnects", async () => {
    const { chromeApi, createDocument, getContexts, connect } = createChromeApi({});
    const manager = createServiceWorkerHeartbeatManager(chromeApi);
    manager.install();
    await vi.waitFor(() => {
      expect(createDocument).toHaveBeenCalled();
    });

    let notifyDisconnect: (() => void) | undefined;
    connect(
      createHeartbeatPort((listener) => {
        notifyDisconnect = listener;
      }),
    );
    getContexts.mockClear();
    createDocument.mockClear();

    notifyDisconnect?.();
    await vi.waitFor(() => {
      expect(getContexts).toHaveBeenCalled();
      expect(createDocument).toHaveBeenCalledTimes(1);
    });
  });
});
