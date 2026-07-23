import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { STAGEHAND_PROTOCOL_VERSION, STAGEHAND_RUNTIME_VERSION } from "../protocol/schemas.js";
import type { RuntimeDescriptor } from "../protocol/types.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { V3Context } from "./understudy/context.js";

type StagehandRuntimeMarker = RuntimeDescriptor & {
  name: "stagehand";
  version: "stagehand.v4";
};

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: StagehandRuntimeMarker;
  __stagehandReceiveFromHost?: (raw: unknown) => Promise<void>;
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
      browserSessionFactory: async (cdpUrl, logger) => {
        const locatorRuntimeResponse = await fetch(chrome.runtime.getURL("content-script.js"));
        if (!locatorRuntimeResponse.ok) {
          throw new Error(
            `Failed to load Stagehand locator runtime: ${locatorRuntimeResponse.status}`,
          );
        }
        return V3Context.create(cdpUrl, {
          websocketFactory: browserWebSocketFactory,
          logger,
          blankPageUrl: chrome.runtime.getURL("blank.html"),
          fallbackLocatorScriptSource: await locatorRuntimeResponse.text(),
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

  rpcClient = new RPCClient(chromeRuntimeClient, new RPCRouter(activeRuntime));
  scope.__stagehand_runtime = {
    name: "stagehand",
    version: "stagehand.v4",
    protocolVersion: STAGEHAND_PROTOCOL_VERSION,
    serverInfo: {
      name: "stagehand",
      version: STAGEHAND_RUNTIME_VERSION,
    },
  };
  scope.__stagehandReceiveFromHost = (raw) => chromeRuntimeClient.receive(raw);

  return rpcClient;
}

if (typeof chrome !== "undefined") {
  installServiceWorkerHeartbeat();
  startStagehandServiceWorker();
}
