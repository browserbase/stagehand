import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { resolveResidentBrowserWebSocketUrl } from "./service-worker-lifecycle/resident-browser-proxy.js";
import {
  ResidentRuntimeLifecycle,
  type StagehandRuntimeMarker,
} from "./service-worker-lifecycle/resident-runtime.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { ChromeTabTargetAdapter } from "./understudy/chromeTabs.js";
import { BrowserContext } from "./understudy/context.js";

declare global {
  interface ImportMeta {
    readonly env: {
      readonly VITE_STAGEHAND_BROWSER_PROXY_URL?: string;
    };
  }
}

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: StagehandRuntimeMarker;
  __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
};

export type StartStagehandServiceWorkerOptions = {
  autoBootstrap?: boolean;
  browserProxyUrl?: string;
  resolveResidentWebSocketUrl?: () => Promise<string>;
  startedAt?: number;
};

export function startStagehandServiceWorker(
  scope: StagehandServiceWorkerScope = globalThis as typeof globalThis &
    StagehandServiceWorkerScope,
  runtime?: StagehandRuntime,
  options: StartStagehandServiceWorkerOptions = {},
): RPCClient {
  const chromeRuntimeClient = new ChromeRuntimeClient(scope, STAGEHAND_SEND_TO_HOST_BINDING);
  const receiverReady = deferred();
  installServiceWorkerHeartbeat();
  let rpcClient: RPCClient | undefined;
  const activeRuntime =
    runtime ??
    createStagehandRuntime({
      browserSessionFactory: async (cdpUrl, logger, lifecycle) => {
        const locatorRuntimeResponse = await fetch(chrome.runtime.getURL("content-script.js"));
        if (!locatorRuntimeResponse.ok) {
          throw new Error(
            `Failed to load Stagehand locator runtime: ${locatorRuntimeResponse.status}`,
          );
        }
        const fallbackLocatorScriptSource = await locatorRuntimeResponse.text();
        const residentConnection = lifecycle?.bootstrapMode === "resident";
        return BrowserContext.create(cdpUrl, {
          websocketFactory: browserWebSocketFactory,
          logger,
          blankPageUrl: chrome.runtime.getURL("blank.html"),
          fallbackLocatorScriptSource,
          chromeTabs: new ChromeTabTargetAdapter(chrome),
          ensureInitialPage: !residentConnection,
          deferPageInstrumentation: residentConnection,
          ...(lifecycle?.onConnected ? { onConnected: () => lifecycle.onConnected?.() } : {}),
          ...(lifecycle?.onDisconnected
            ? { onDisconnected: () => lifecycle.onDisconnected?.() }
            : {}),
        });
      },
      emitLog: (log) => {
        void rpcClient?.notify(StagehandNotifications.log, log).catch((error: unknown) => {
          // The JSON-RPC log sink itself failed, so no Stagehand logger is safe here.
          // oxlint-disable-next-line no-console
          console.error("[stagehand] Failed to emit log notification", error);
        });
      },
      clientLLMGenerate: async (params) => {
        if (!rpcClient) throw new Error("Stagehand RPC client is not connected");
        return await rpcClient.send(StagehandMethods.llmGenerate, params);
      },
    });

  const configuredBrowserProxyUrl =
    options.browserProxyUrl ?? import.meta.env.VITE_STAGEHAND_BROWSER_PROXY_URL?.trim();
  const resolveResidentWebSocketUrl =
    options.resolveResidentWebSocketUrl ??
    (configuredBrowserProxyUrl
      ? async () => await resolveResidentBrowserWebSocketUrl(configuredBrowserProxyUrl)
      : undefined);
  const residentRuntime = new ResidentRuntimeLifecycle(activeRuntime, {
    ...(resolveResidentWebSocketUrl ? { resolveResidentWebSocketUrl } : {}),
    waitForRpcReceiver: () => receiverReady.promise,
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  });
  rpcClient = new RPCClient(
    chromeRuntimeClient,
    new RPCRouter(activeRuntime, {
      initializeStagehand: async (params) => {
        if (params.browserCdpUrl) {
          return await residentRuntime.initializeWithBrowserCdpUrl({
            ...params,
            browserCdpUrl: params.browserCdpUrl,
          });
        }
        return await residentRuntime.initialize(params);
      },
      closeStagehand: () => residentRuntime.close(),
      closeContext: () => residentRuntime.close(),
    }),
  );
  scope.__stagehand_runtime = residentRuntime.marker;
  scope.__stagehandReceiveFromHost = (raw) => chromeRuntimeClient.receive(raw);
  receiverReady.resolve();

  const autoBootstrap = options.autoBootstrap ?? resolveResidentWebSocketUrl !== undefined;
  if (autoBootstrap) {
    void residentRuntime.bootstrap().catch(() => {
      // oxlint-disable-next-line no-console
      console.error("[stagehand] Resident runtime bootstrap failed");
    });
  }

  return rpcClient;
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

if (typeof chrome !== "undefined") {
  const startedAt = performance.now();
  startStagehandServiceWorker(undefined, undefined, { startedAt });
}
