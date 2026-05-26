import type { AgentEvidenceCallback } from "../../types/public/agentEvidenceEvents.js";
import type { LogLine } from "../../types/public/logs.js";

// onEvidence is a user-supplied observability hook (trajectory recording,
// verifier capture, etc.). Wrap it once at the boundary where the handler
// receives it so a throwing user callback can never abort the agent loop —
// internal emit sites can then call the wrapped callback directly without
// per-site try/catch.
export function wrapEvidenceCallback(
  callback: AgentEvidenceCallback | undefined,
  logger: (message: LogLine) => void,
): AgentEvidenceCallback | undefined {
  if (!callback) return undefined;
  return async (event) => {
    try {
      await callback(event);
    } catch (e) {
      logger({
        category: "agent",
        message: `Warning: onEvidence callback failed for ${event.type}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        level: 1,
      });
    }
  };
}
