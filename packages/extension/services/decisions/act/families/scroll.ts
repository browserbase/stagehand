import { parsePercent } from "../../args.js";
import { choiceAnswer, type DecisionResponse } from "../../client.js";
import { pickTarget } from "../../pick.js";
import { buildView, isMainDocumentScroller } from "../../tree.js";
import { fallback } from "../outcomes.js";
import { describeLine, selectorFor, snapshot } from "../page.js";
import { act, rejected } from "../perform.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

/** Scrolling: the page itself, or the scrollable region the instruction names. */

export async function runScroll(
  ctx: PipelineContext,
  method: string,
  intent: DecisionResponse,
): Promise<DecisionsActOutcome> {
  let args: string[] = [];
  if (method === "scrollTo") {
    const percent = parsePercent(ctx.instruction);
    if (!percent) return fallback("scroll_no_percent");
    args = [percent];
  }

  const snap = await snapshot(ctx.deps);
  // "Scroll the page" names no element, so asking the decision model to match one only
  // produces hedged answers; the scope decides the main document in code.
  const scope = choiceAnswer(intent, "scroll_scope");
  let target =
    scope.choice === "whole_page" && scope.confidence >= ctx.threshold
      ? buildView(snap.nodes, "scroll").find((node) => isMainDocumentScroller(snap.nodes, node))
      : undefined;
  ctx.trace.push({
    node: "scroll_scope",
    ms: 0,
    choice: scope.choice,
    confidence: scope.confidence,
    resolved: target?.id ?? null,
  });
  if (!target) {
    const picked = await pickTarget(
      ctx,
      "target",
      snap,
      ["scroll"],
      "Which page or scrollable container should be scrolled to carry out the instruction?",
    );
    if (!picked.target) return await rejected(ctx, snap, "scroll_target_rejected", picked);
    target = picked.target;
  }

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  return await act(ctx, {
    selector,
    description: `${method} ${describeLine(target)}`,
    method,
    arguments: args,
  });
}
