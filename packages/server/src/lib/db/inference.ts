import type { StagehandMetrics } from "@browserbasehq/stagehand";

import { db } from "./index.js";
import { inference } from "./schema.js";

export const createInference = async (
  actionId: string,
  metrics: Pick<
    StagehandMetrics,
    "totalPromptTokens" | "totalCompletionTokens" | "totalInferenceTimeMs"
  >,
) => {
  const [createdInference] = await db.insert(inference).values({
    actionId,
    inputTokens: metrics.totalPromptTokens,
    outputTokens: metrics.totalCompletionTokens,
    timeMs: metrics.totalInferenceTimeMs,
  });

  return createdInference;
};
