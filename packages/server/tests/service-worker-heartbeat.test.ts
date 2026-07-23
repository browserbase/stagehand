import { describe, expect, it, vi } from "vite-plus/test";
import {
  createServiceWorkerHeartbeatManager,
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
