import "./zod-runtime.js";
import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION } from "../protocol/schemas.js";
import type { RuntimeDescriptor } from "../protocol/types.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { ChromeTabTargetAdapter } from "./understudy/chromeTabs.js";
import { BrowserContext } from "./understudy/context.js";
import { STAGEHAND_RUNTIME_VERSION } from "./version.js";
import type { CallbackBatchRuntimeAttachments } from "./callbackBatch.js";

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: RuntimeDescriptor;
  __stagehandReceiveFromHost?: (
    raw: unknown,
    runtimeAttachments?: CallbackBatchRuntimeAttachments,
  ) => Promise<void>;
};

export function startStagehandServiceWorker(
  scope: StagehandServiceWorkerScope = globalThis as typeof globalThis &
    StagehandServiceWorkerScope,
  runtime?: StagehandRuntime,
): RPCClient {
  const chromeRuntimeClient = new ChromeRuntimeClient(scope, STAGEHAND_SEND_TO_HOST_BINDING);
  let rpcClient: RPCClient | undefined;
  const activeRuntime =
    runtime ??
    createStagehandRuntime({
      browserSessionFactory: async (cdpUrl, logger, bootstrapLogger) => {
        const locatorRuntimeResponse = await fetch(chrome.runtime.getURL("content-script.js"));
        if (!locatorRuntimeResponse.ok) {
          throw new Error(
            `Failed to load Stagehand locator runtime: ${locatorRuntimeResponse.status}`,
          );
        }
        return BrowserContext.create(cdpUrl, {
          websocketFactory: browserWebSocketFactory,
          logger,
          blankPageUrl: chrome.runtime.getURL("blank.html"),
          fallbackLocatorScriptSource: await locatorRuntimeResponse.text(),
          chromeTabs: new ChromeTabTargetAdapter(chrome),
          bootstrapLogger,
        });
      },
      emitLog: (log) => {
        void rpcClient?.notify(StagehandNotifications.log, log).catch((error: unknown) => {
          // The JSON-RPC log sink itself failed, so no Stagehand logger is safe here.
          // oxlint-disable-next-line no-console
          console.error("[stagehand] Failed to emit log notification", error);
        });
      },
      emitPageCDPEvent: (notification) => {
        void rpcClient
          ?.notify(StagehandNotifications.pageCDPEvent, notification)
          .catch((error: unknown) => {
            // This notification cannot safely report its own delivery failure over JSON-RPC.
            // oxlint-disable-next-line no-console
            console.error("[stagehand] Failed to emit page CDP event notification", error);
          });
      },
      clientLLMGenerate: async (params) => {
        if (!rpcClient) throw new Error("Stagehand RPC client is not connected");
        return await rpcClient.send(StagehandMethods.llmGenerate, params);
      },
    });

  const router = new RPCRouter(activeRuntime);
  rpcClient = new RPCClient(chromeRuntimeClient, router);
  scope.__stagehand_runtime = {
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    serverInfo: {
      name: "stagehand",
      version: STAGEHAND_RUNTIME_VERSION,
    },
  };
  scope.__stagehandReceiveFromHost = (raw, runtimeAttachments) =>
    chromeRuntimeClient.receive(raw, runtimeAttachments);

  return rpcClient;
}

if (typeof chrome !== "undefined") {
  installServiceWorkerHeartbeat();
  startStagehandServiceWorker();
}
