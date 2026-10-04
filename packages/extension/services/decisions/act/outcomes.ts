import type { ActResultData } from "@browserbasehq/stagehand-protocol/types";
import type { TargetResult } from "../pick.js";
import type { Done, Fallback } from "./types.js";

/**
 * Builders and predicates for pipeline outcomes: done, failed, or handed over.
 */

/** Only a shortlist the decision model actually believed in; a flat guess would just mislead the LLM. */
export function isDetached(outcome: Done | Fallback): boolean {
  return (
    outcome.kind === "fallback" &&
    /notconnected|not connected|detached|no node (with|found)|stale|could not find an element/i.test(
      outcome.reason,
    )
  );
}

export function focusIds(picked: TargetResult): string[] | undefined {
  return picked.credible ? picked.ranked.map((entry) => entry.id) : undefined;
}

export function merge(first: Done, second: Done): Done {
  return {
    kind: "done",
    result: {
      success: first.result.success && second.result.success,
      message: `${first.result.message} → ${second.result.message}`,
      actionDescription: first.result.actionDescription,
      actions: [...first.result.actions, ...second.result.actions],
    },
  };
}

export function failure(instruction: string, message: string): Done {
  return {
    kind: "done",
    result: { success: false, message, actionDescription: instruction, actions: [] },
  };
}

export function fallback(
  reason: string,
  priorActions?: ActResultData["actions"],
  focus?: string[],
): Fallback {
  return {
    kind: "fallback",
    reason,
    ...(priorActions?.length ? { priorActions } : {}),
    ...(focus?.length ? { focusIds: focus } : {}),
  };
}
