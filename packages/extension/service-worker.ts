import {
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandNotifications,
} from "../protocol/schema-registry.js";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { V3Context } from "./understudy/context.js";

export type StagehandServiceWorkerScope = {
  __stagehand_runtime?: {
    name: "stagehand";
    version: "stagehand.v4";
  };
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
      browserSessionFactory: (cdpUrl, logger) =>
        V3Context.create(cdpUrl, { websocketFactory: browserWebSocketFactory, logger }),
      emitLog: (log) => {
        void rpcClient?.notify(StagehandNotifications.log, log).catch((error: unknown) => {
          // The JSON-RPC log sink itself failed, so no Stagehand logger is safe here.
          // oxlint-disable-next-line no-console
          console.error("[stagehand] Failed to emit log notification", error);
        });
      },
    });

  rpcClient = new RPCClient(chromeRuntimeClient, new RPCRouter(activeRuntime));
  scope.__stagehand_runtime = {
    name: "stagehand",
    version: "stagehand.v4",
  };
  scope.__stagehandReceiveFromHost = (raw) => chromeRuntimeClient.receive(raw);

  return rpcClient;
}

if (typeof chrome !== "undefined") {
  installServiceWorkerHeartbeat();
  startStagehandServiceWorker();
}
