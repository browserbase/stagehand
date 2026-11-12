import { StagehandMethods } from "@browserbasehq/stagehand-protocol/schema-registry";
import { createDecisionChooseResultSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type {
  DecisionChooseParams,
  DecisionChooseResult,
} from "@browserbasehq/stagehand-protocol/types";
import type { RPCClient, RPCRequestContext } from "./rpcClient.js";

/** Internal registration boundary; Stagehand owns configuration and teardown. */
export function registerDecisionHandler(
  client: RPCClient,
  choose: (
    params: DecisionChooseParams,
    context: RPCRequestContext,
  ) => DecisionChooseResult | Promise<DecisionChooseResult>,
): () => void {
  return client.onRequest(StagehandMethods.decisionChoose, async (params, context) => {
    // Snapshot allowed IDs before application code can mutate its request object.
    const resultSchema = createDecisionChooseResultSchema(params);
    return resultSchema.parse(await choose(params, context));
  });
}
