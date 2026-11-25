import type { BrowserApiPlatform } from "./platform.js";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import type { StagehandRpcNotification } from "@browserbasehq/stagehand-protocol/types";
import type { z } from "zod/v4";

/** The transport-independent command boundary used by Stagehand's browser API. */
export interface StagehandCommandClient {
  /** Defaults to browser capabilities when omitted. The SDK supplies Node capabilities. */
  readonly platform?: BrowserApiPlatform;
  send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>>;
  onNotification(listener: (notification: StagehandRpcNotification) => void): () => void;
}
