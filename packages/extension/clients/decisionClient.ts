import {
  StagehandMethods,
  StagehandNotifications,
} from "@browserbasehq/stagehand-protocol/schema-registry";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { RPCClient } from "./rpcClient.js";

export async function requestDecision(
  client: RPCClient,
  params: DecisionChooseParams,
  signal: AbortSignal,
): Promise<DecisionChooseResult> {
  return await client.send(StagehandMethods.decisionChoose, params, {
    signal,
    onAbort: (requestId, reason) =>
      client.notify(StagehandNotifications.decisionCancel, {
        requestId,
        reason: reason instanceof Error && reason.name === "TimeoutError" ? "timeout" : "cancelled",
      }),
  });
}
