import {
  AVAILABLE_CUA_MODELS,
  type AgentToolMode,
} from "@browserbasehq/stagehand";

// Mirrors packages/core/lib/v3/types/private/agent.ts. Keep this local until
// core exposes a public model-capability helper.
const HYBRID_CAPABLE_MODEL_PATTERNS = [
  "gemini-3",
  "claude",
  "gpt-5.4",
  "gpt-5.5",
] as const;

export function isCuaCapableModel(modelName: string): boolean {
  return (AVAILABLE_CUA_MODELS as readonly string[]).includes(modelName);
}

export function isHybridCapableModel(modelName: string): boolean {
  return HYBRID_CAPABLE_MODEL_PATTERNS.some((pattern) =>
    modelName.includes(pattern),
  );
}

export function inferDefaultStagehandAgentMode(
  modelName: string,
): AgentToolMode {
  if (isHybridCapableModel(modelName)) return "hybrid";
  if (isCuaCapableModel(modelName)) return "cua";
  return "dom";
}
