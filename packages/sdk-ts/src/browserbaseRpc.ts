import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type { BrowserbaseConnection } from "./browserbaseConnection.js";
import { executeBrowserbaseRequest } from "./browserbaseTransport.js";
import type { RPCClient } from "./rpcClient.js";

/** Installs Browserbase request handling for one RPC connection. */
export function registerBrowserbaseTransport(
  client: RPCClient,
  connection: BrowserbaseConnection | undefined,
): () => void {
  const pending = new Map<number, AbortController>();
  const removeRequest = client.onRequest(
    StagehandMethods.browserbaseRequest,
    async (params, context) => {
      if (pending.has(context.requestId))
        throw new Error("Browserbase request ID is already in use");
      const controller = new AbortController();
      pending.set(context.requestId, controller);
      try {
        return await executeBrowserbaseRequest(
          connection,
          params,
          AbortSignal.any([context.signal, controller.signal]),
        );
      } finally {
        pending.delete(context.requestId);
      }
    },
  );
  const removeNotification = client.onNotification((notification) => {
    if (notification.method !== StagehandNotifications.browserbaseCancel.name) return;
    const { requestId, reason } = notification.params;
    pending
      .get(requestId)
      ?.abort(
        new DOMException(
          reason === "timeout" ? "Browserbase request timed out" : "Browserbase request cancelled",
          reason === "timeout" ? "TimeoutError" : "AbortError",
        ),
      );
  });
  return () => {
    removeRequest();
    removeNotification();
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  };
}
