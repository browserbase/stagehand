import type { AgentStepFinishedEvent } from "../../types/public/agentEvidenceEvents.js";

export function inferToolOutput(
  toolResult: unknown,
): AgentStepFinishedEvent["toolOutput"] {
  const error =
    toolResult &&
    typeof toolResult === "object" &&
    "error" in toolResult &&
    typeof (toolResult as { error?: unknown }).error === "string"
      ? (toolResult as { error: string }).error
      : undefined;

  const isError =
    toolResult &&
    typeof toolResult === "object" &&
    "isError" in toolResult &&
    Boolean((toolResult as { isError?: unknown }).isError);

  return {
    ok: error === undefined && !isError,
    result: toolResult,
    error,
  };
}
