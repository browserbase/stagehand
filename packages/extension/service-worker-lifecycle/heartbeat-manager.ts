export const STAGEHAND_SERVICE_WORKER_HEARTBEAT_PATH = "offscreen/service-worker-heartbeat.html";
export const STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT = "StagehandExtensionServiceWorkerHeartbeat";

type ChromeEvent<Arguments extends unknown[] = []> = {
  addListener(listener: (...args: Arguments) => void): void;
};

type RuntimePort = {
  name: string;
  onDisconnect: ChromeEvent;
  onMessage: ChromeEvent<[message: unknown]>;
};

export type ServiceWorkerHeartbeatChrome = {
  offscreen?: {
    createDocument(parameters: {
      justification: string;
      reasons: string[];
      url: string;
    }): Promise<void>;
  };
  runtime: {
    getContexts(filter: {
      contextTypes: ["OFFSCREEN_DOCUMENT"];
      documentUrls: [string];
    }): Promise<unknown[]>;
    getURL(path: string): string;
    onConnect: ChromeEvent<[port: RuntimePort]>;
    onStartup: ChromeEvent;
  };
  tabs: {
    onCreated: ChromeEvent;
  };
};

export type ServiceWorkerHeartbeatManager = {
  ensure(): Promise<void>;
  install(): void;
};

export function createServiceWorkerHeartbeatManager(
  chromeApi: ServiceWorkerHeartbeatChrome,
  onError: (error: unknown) => void = (error) =>
    // oxlint-disable-next-line no-console -- Heartbeat failures can occur before telemetry is available.
    console.error("Stagehand service worker heartbeat failed", error),
): ServiceWorkerHeartbeatManager {
  let creatingDocument: Promise<void> | null = null;
  let heartbeatPort: RuntimePort | null = null;
  let installed = false;

  async function ensure(): Promise<void> {
    const offscreen = chromeApi.offscreen;
    if (offscreen == null) return;

    const offscreenUrl = chromeApi.runtime.getURL(STAGEHAND_SERVICE_WORKER_HEARTBEAT_PATH);
    const existingContexts = await chromeApi.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    if (existingContexts.length > 0) return;

    creatingDocument ??= offscreen
      .createDocument({
        url: STAGEHAND_SERVICE_WORKER_HEARTBEAT_PATH,
        reasons: ["BLOBS"],
        justification: "Maintain service worker liveness for long-running sessions.",
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Only a single offscreen document may be created")) return;
        throw error;
      })
      .finally(() => {
        creatingDocument = null;
      });

    await creatingDocument;
  }

  function requestEnsure(): void {
    void ensure().catch(onError);
  }

  function onConnect(port: RuntimePort): void {
    if (port.name !== STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT) return;

    heartbeatPort = port;
    port.onMessage.addListener(() => {
      // Receiving the offscreen page's periodic message is itself the wake signal.
    });
    port.onDisconnect.addListener(() => {
      if (heartbeatPort === port) heartbeatPort = null;
    });
  }

  function install(): void {
    if (installed) return;
    installed = true;

    chromeApi.runtime.onConnect.addListener(onConnect);
    chromeApi.runtime.onStartup.addListener(requestEnsure);
    chromeApi.tabs.onCreated.addListener(requestEnsure);
    requestEnsure();
  }

  return { ensure, install };
}

export function installServiceWorkerHeartbeat(): void {
  const chromeApi = (globalThis as typeof globalThis & { chrome?: ServiceWorkerHeartbeatChrome })
    .chrome;
  if (chromeApi == null) return;
  createServiceWorkerHeartbeatManager(chromeApi).install();
}
