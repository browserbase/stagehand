import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import {
  createPid2WebSocketFactory,
  STAGEHAND_PID2_WEBSOCKET_URL,
} from "./service-worker-lifecycle/pid2-transport.js";
import {
  ResidentRuntimeLifecycle,
  type StagehandRuntimeMarker,
} from "./service-worker-lifecycle/resident-runtime.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { ChromeTabTargetAdapter } from "./understudy/chromeTabs.js";
import { V3Context } from "./understudy/context.js";

const RESIDENT_BOOTSTRAP_ATTEMPTS = 3;
const RESIDENT_BOOTSTRAP_RETRY_DELAYS_MS = [100, 250] as const;

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: StagehandRuntimeMarker;
  __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
};

export type StartStagehandServiceWorkerOptions = {
  autoBootstrap?: boolean;
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
  const heartbeat = installServiceWorkerHeartbeat();
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
        const residentConnection = cdpUrl === STAGEHAND_PID2_WEBSOCKET_URL;
        const websocketFactory = residentConnection
          ? createPid2WebSocketFactory(browserWebSocketFactory, async (activation) => {
              await lifecycle?.onActivation?.(activation.activationEpoch);
            })
          : browserWebSocketFactory;
        return V3Context.create(cdpUrl, {
          websocketFactory,
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

  const residentRuntime = new ResidentRuntimeLifecycle(activeRuntime, {
    resolveResidentWebSocketUrl:
      options.resolveResidentWebSocketUrl ?? (() => Promise.resolve(STAGEHAND_PID2_WEBSOCKET_URL)),
    waitForRpcReceiver: () => receiverReady.promise,
    onActive: async () => await heartbeat?.start(),
    onInactive: async () => await heartbeat?.stop(),
    ...(options.startedAt === undefined ? {} : { startedAt: options.startedAt }),
  });
  rpcClient = new RPCClient(
    chromeRuntimeClient,
    new RPCRouter(activeRuntime, {
      initializeStagehand: (params) => residentRuntime.initialize(params),
    }),
  );
  scope.__stagehand_runtime = residentRuntime.marker;
  scope.__stagehandReceiveFromHost = (raw) => chromeRuntimeClient.receive(raw);
  receiverReady.resolve();

  if (options.autoBootstrap ?? typeof chrome !== "undefined") {
    void bootstrapResidentRuntime(residentRuntime).catch((error: unknown) => {
      // oxlint-disable-next-line no-console
      console.error("[stagehand] Resident runtime bootstrap failed", error);
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

async function bootstrapResidentRuntime(lifecycle: ResidentRuntimeLifecycle): Promise<void> {
  let lastError: unknown = new Error("Resident runtime bootstrap failed");
  for (let attempt = 0; attempt < RESIDENT_BOOTSTRAP_ATTEMPTS; attempt += 1) {
    const retryDelay = RESIDENT_BOOTSTRAP_RETRY_DELAYS_MS[attempt - 1];
    if (retryDelay !== undefined) await delay(retryDelay);
    try {
      await lifecycle.bootstrap();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

if (typeof chrome !== "undefined") {
  const startedAt = performance.now();
  startStagehandServiceWorker(undefined, undefined, { startedAt });
}
