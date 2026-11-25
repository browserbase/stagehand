import { requestBrowserbase } from "./clients/browserbaseClient.js";
import {
  STAGEHAND_HOST_CDP_RELAY_URL,
  STAGEHAND_SEND_TO_HOST_BINDING,
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import { STAGEHAND_PROTOCOL_VERSION } from "@browserbasehq/stagehand-protocol/schemas";
import type { RuntimeDescriptor } from "@browserbasehq/stagehand-protocol/types";
import { ChromeRuntimeClient } from "./clients/chromeRuntimeClient.js";
import { RPCClient } from "./clients/rpcClient.js";
import { RPCRouter } from "./rpcRouter.js";
import { injectContentScriptIntoOpenTabs } from "./service-worker-lifecycle/content-script-injection.js";
import { installServiceWorkerHeartbeat } from "./service-worker-lifecycle/heartbeat-manager.js";
import { createStagehandRuntime, type StagehandRuntime } from "./runtime.js";
import { browserWebSocketFactory } from "./understudy/browserWebSocketTransport.js";
import { hostRelayWebSocketFactory } from "./understudy/hostRelayTransport.js";
import { ChromeTabTargetAdapter } from "./understudy/chromeTabs.js";
import { BrowserContext } from "./understudy/context.js";
import { DomainPolicyDnrManager } from "./understudy/domainPolicyDnr.js";
import {
  EXTENSION_BUILD_ID_GLOBAL,
  STAGEHAND_EXTENSION_BUILD_ID,
  STAGEHAND_RUNTIME_VERSION,
} from "./version.js";
import type { CallbackBatchRuntimeAttachments } from "./callbackBatch.js";
import { ClientLifecycle } from "./clientLifecycle.js";

export type StagehandServiceWorkerScope = {
  __stagehandClientLifecycle?: (input: unknown) => Promise<void>;
  __stagehand_runtime?: RuntimeDescriptor;
  [EXTENSION_BUILD_ID_GLOBAL]?: string;
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
  let domainPolicyManager: DomainPolicyDnrManager | undefined;
  const activeRuntime =
    runtime ??
    createStagehandRuntime({
      browserSessionFactory: async (cdpUrl, logger, bootstrapLogger) => {
        domainPolicyManager ??= new DomainPolicyDnrManager(
          chrome.declarativeNetRequest,
          chrome.runtime.id,
        );
        const domainPolicyRules = await domainPolicyManager.openSession();
        try {
          const locatorRuntimeResponse = await fetch(chrome.runtime.getURL("content-script.js"));
          if (!locatorRuntimeResponse.ok) {
            throw new Error(
              `Failed to load Stagehand locator runtime: ${locatorRuntimeResponse.status}`,
            );
          }
          return await BrowserContext.create(cdpUrl, {
            websocketFactory:
              cdpUrl === STAGEHAND_HOST_CDP_RELAY_URL
                ? hostRelayWebSocketFactory
                : browserWebSocketFactory,
            logger,
            blankPageUrl: chrome.runtime.getURL("blank.html"),
            fallbackLocatorScriptSource: await locatorRuntimeResponse.text(),
            chromeTabs: new ChromeTabTargetAdapter(chrome),
            bootstrapLogger,
            domainPolicyRules,
          });
        } catch (error) {
          try {
            await domainPolicyRules.close();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Browser session initialization and domain policy cleanup failed",
            );
          }
          throw error;
        }
      },
      emitLog: (log) => {
        void rpcClient?.notify(StagehandNotifications.log, log).catch((error: unknown) => {
          // oxlint-disable-next-line no-console
          console.error("[stagehand] Failed to emit log notification", error);
        });
      },
      emitPageCDPEvent: (notification) => {
        void rpcClient
          ?.notify(StagehandNotifications.pageCDPEvent, notification)
          .catch((error: unknown) => {
            // oxlint-disable-next-line no-console
            console.error("[stagehand] Failed to emit page CDP event notification", error);
          });
      },
      emitPageEvent: (notification) => {
        void rpcClient
          ?.notify(StagehandNotifications.pageEvent, notification)
          .catch((error: unknown) => {
            // oxlint-disable-next-line no-console
            console.error("[stagehand] Failed to emit page event notification", error);
          });
      },
      clientBrowserbaseRequest: async (params, signal) => {
        if (!rpcClient) throw new Error("Stagehand RPC client is not connected");
        return await requestBrowserbase(rpcClient, params, signal);
      },
      clientLLMGenerate: async (params) => {
        if (!rpcClient) throw new Error("Stagehand RPC client is not connected");
        return await rpcClient.send(StagehandMethods.llmGenerate, params);
      },
    });

  const router = new RPCRouter(activeRuntime);
  rpcClient = new RPCClient(chromeRuntimeClient, router);
  const lifecycle = new ClientLifecycle({
    connection: async (cdpUrl) => {
      await activeRuntime.ensureBrowserConnection(cdpUrl);
      const session = activeRuntime.browserSession;
      if (!(session instanceof BrowserContext)) {
        throw new Error("Stagehand client lifecycle requires a CDP browser connection");
      }
      return session.conn;
    },
    rejectClientCallbacks: () => rpcClient?.releaseClient(),
    closeConnection: () => activeRuntime.disconnectBrowser(),
    disposeClient: () => activeRuntime.disposeStagehandInstance(),
    onError: (error) => {
      // oxlint-disable-next-line no-console
      console.error("Stagehand client lifecycle cleanup failed", error);
    },
  });
  scope.__stagehandClientLifecycle = async (input) => {
    const action =
      typeof input === "object" && input !== null && "action" in input ? input.action : undefined;
    try {
      await lifecycle.handle(input);
    } catch (error) {
      if (action === "detach") rpcClient?.acceptClient();
      throw error;
    }
    if (action === "attach") rpcClient?.acceptClient();
  };
  // Kept out of the runtime descriptor: released SDKs parse that descriptor strictly.
  scope[EXTENSION_BUILD_ID_GLOBAL] = STAGEHAND_EXTENSION_BUILD_ID;
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
  // Every worker start, since onInstalled misses re-enable; a rerun in a live world is a no-op.
  void injectContentScriptIntoOpenTabs(chrome);
  startStagehandServiceWorker();
}
