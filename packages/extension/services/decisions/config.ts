import type { DecisionModelConfig } from "./client.js";

export type DecisionsConfig = DecisionModelConfig & {
  actConfidence?: number;
  verify?: "off" | "checks" | "full";
  llmFallback?: boolean;
  argumentLlm?: boolean;
  pageState?: boolean;
  retryNoEffect?: boolean;
  focusFallback?: boolean;
  cacheCheck?: boolean;
  extract?: "judge" | "pick";
  targetReadiness?: boolean;
  tools?: boolean;
};
