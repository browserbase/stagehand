import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  BrowserbaseRequestParams,
  BrowserbaseRequestResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { RPCClient } from "./rpcClient.js";

export type ClientBrowserbaseRequest = (
  params: BrowserbaseRequestParams,
  signal?: AbortSignal,
) => Promise<Response>;

/** Requests one buffered Browserbase HTTP attempt over the connected SDK. */
export async function requestBrowserbase(
  client: RPCClient,
  params: BrowserbaseRequestParams,
  signal?: AbortSignal,
): Promise<Response> {
  let result: BrowserbaseRequestResult;
  try {
    result = await client.send(StagehandMethods.browserbaseRequest, params, {
      signal,
      onAbort: (requestId, reason) =>
        client.notify(StagehandNotifications.browserbaseCancel, {
          requestId,
          reason: isTimeout(reason) ? "timeout" : "cancelled",
        }),
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new DOMException(
        isTimeout(signal.reason)
          ? "Browserbase request timed out"
          : "Browserbase request cancelled",
        isTimeout(signal.reason) ? "TimeoutError" : "AbortError",
      );
    }
    // RPC failures are separate from upstream HTTP/network failures.
    throw new Error(
      client.closed ? "Browserbase connection is disconnected" : "Browserbase RPC request failed",
      {
        cause: { error },
      },
    );
  }

  if (result.type === "error") {
    switch (result.reason) {
      case "network":
        // Match native fetch's network error so AI SDK retains retry ownership.
        throw new TypeError("fetch failed", { cause: result });
      case "cancelled":
        throw new DOMException(result.message, "AbortError");
      case "timeout":
        throw new DOMException(result.message, "TimeoutError");
      case "unavailable":
      case "disconnected":
        throw new Error(result.message, { cause: result });
    }
  }

  const response = new Response([204, 205, 304].includes(result.status) ? null : result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
  // A string body adds a default content type; keep the upstream header set.
  if (!new Headers(result.headers).has("content-type")) response.headers.delete("content-type");
  return response;
}

function isTimeout(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "TimeoutError";
}
