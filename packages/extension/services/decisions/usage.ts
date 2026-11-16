import type { StagehandResultUsage } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { DecisionsConfig } from "./config.js";

export function withDecisionUsage(
  config: DecisionsConfig | undefined,
  signal: AbortSignal,
  logger: StagehandLogger,
  usage?: StagehandResultUsage,
): DecisionsConfig | undefined {
  if (!config) return undefined;
  return {
    ...config,
    signal: config.signal ? AbortSignal.any([config.signal, signal]) : signal,
    recordDecisionUsage: (tokens) => {
      if (usage) {
        usage.inputTokens += tokens.inputTokens;
        usage.outputTokens += tokens.outputTokens;
      }
      config.recordDecisionUsage?.(tokens);
      logger.info("Decision model usage", { category: "decisions-usage", ...tokens });
    },
  };
}
