import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { resolveLocalDebuggerUrl } from "./service-worker-lifecycle/local-debugger.js";
import {
  ResidentRuntimeLifecycle,
  type StagehandRuntimeMarker,
} from "./service-worker-lifecycle/resident-runtime.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { ChromeTabTargetAdapter } from "./understudy/chromeTabs.js";
import { V3Context } from "./understudy/context.js";

const RESIDENT_BOOTSTRAP_ATTEMPTS = 3;

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: StagehandRuntimeMarker;
  __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
};

export type StartStagehandServiceWorkerOptions = {
  autoBootstrap?: boolean;
  resolveDebuggerUrl?: () => Promise<string>;
  startedAt?: number;
};

export function startStagehandServiceWorker(
  scope: StagehandServiceWorkerScope = globalThis as typeof globalThis &
    StagehandServiceWorkerScope,
  runtime?: StagehandRuntime,
  options: StartStagehandServiceWorkerOptions = {},
): RPCClient {
  const chromeRuntimeClient = new ChromeRuntimeClient(scope, STAGEHAND_SEND_TO_HOST_BINDING);
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
        lifecycle?.onConnecting?.();
        return V3Context.create(cdpUrl, {
          websocketFactory: browserWebSocketFactory,
          logger,
          blankPageUrl: chrome.runtime.getURL("blank.html"),
          fallbackLocatorScriptSource,
          chromeTabs: new ChromeTabTargetAdapter(chrome),
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

  const residentRuntime = new ResidentRuntimeLifecycle(activeRuntime, {
    resolveDebuggerUrl: options.resolveDebuggerUrl ?? resolveLocalDebuggerUrl,
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  });
  rpcClient = new RPCClient(
    chromeRuntimeClient,
    new RPCRouter(activeRuntime, {
      beforeRuntimeConfigure: () => residentRuntime.disableAutoBootstrap(),
    }),
  );
  scope.__stagehand_runtime = residentRuntime.marker;
  scope.__stagehandReceiveFromHost = (raw) => chromeRuntimeClient.receive(raw);

  if (options.autoBootstrap ?? typeof chrome !== "undefined") {
    void bootstrapResidentRuntime(residentRuntime).catch((error: unknown) => {
      // oxlint-disable-next-line no-console
      console.error("[stagehand] Resident runtime bootstrap failed", error);
    });
  }

  return rpcClient;
}

async function bootstrapResidentRuntime(lifecycle: ResidentRuntimeLifecycle): Promise<void> {
  let lastError: unknown = new Error("Resident runtime bootstrap failed");
  for (let attempt = 0; attempt < RESIDENT_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    try {
      await lifecycle.bootstrap();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

if (typeof chrome !== "undefined") {
  const startedAt = performance.now();
  installServiceWorkerHeartbeat();
  startStagehandServiceWorker(undefined, undefined, { startedAt });
}
