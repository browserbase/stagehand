import type { BrowserbaseRequestParams } from "@browserbasehq/stagehand-protocol/types";
import type { BrowserbaseConnection } from "../../../sdk-ts/src/browserbaseConnection.js";
import { executeBrowserbaseRequest } from "../../../sdk-ts/src/browserbaseTransport.js";
import {
  requestBrowserbase,
  type ClientBrowserbaseRequest,
} from "../../clients/browserbaseClient.js";
import type { RPCClient } from "../../clients/rpcClient.js";

// Exercise SDK HTTP and the worker response adapter; RPC dispatch has separate coverage.
export function browserbaseRequest(connection: BrowserbaseConnection): ClientBrowserbaseRequest {
  const client = {
    closed: false,
    send: (
      _method: unknown,
      params: BrowserbaseRequestParams,
      options?: { signal?: AbortSignal },
    ) => executeBrowserbaseRequest(connection, params, options?.signal),
  } as unknown as RPCClient;
  return (params, signal) => requestBrowserbase(client, params, signal);
}
