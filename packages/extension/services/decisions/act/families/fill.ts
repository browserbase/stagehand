import { isLoneVariable, quotedStrings, substituteVariables } from "../../args.js";
import { choiceAnswer, type DecisionResponse } from "../../client.js";
import { NONE, pickTarget, type Snapshot, type TargetResult } from "../../pick.js";
import { chooseFromAppeared } from "../choices.js";
import { fallback, isDetached, merge } from "../outcomes.js";
import { describeLine, selectorFor, snapshot } from "../page.js";
import { act, extractText, rejected } from "../perform.js";
import { pickWhenReady, staysPut } from "../readiness.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

export async function runFill(
  ctx: PipelineContext,
  intent: DecisionResponse,
  values: string[],
): Promise<DecisionsActOutcome> {
  let value: string | undefined;
  if (isLoneVariable(values)) {
    value = values[0];
  } else if (values.length > 0) {
    const answer = choiceAnswer(intent, "fill_value");
    ctx.trace.push({
      node: "fill_value",
      ms: 0,
      choice: answer.choice,
      confidence: answer.confidence,
    });
    if (answer.choice !== NONE && answer.confidence >= ctx.threshold) {
      value = values[Number(answer.choice.slice("value_".length))];
    } else if (answer.choice !== NONE) {
      return fallback(`fill_value_unsure:${answer.choice}@${answer.confidence}`);
    }
  }
  const extracting = value === undefined ? extractText(ctx) : undefined;
  if (value === undefined && !extracting) return fallback("fill_no_value");

  const pick = (candidate: Snapshot): Promise<TargetResult> =>
    pickTarget(
      ctx,
      "target",
      candidate,
      ["input", "broad"],
      "Which field should the text be entered into?",
      {
        quotedTargets: quotedStrings(ctx.instruction).filter((quoted) => quoted !== value),
      },
    );
  const [early, extracted] = await Promise.all([
    pickWhenReady(ctx, pick, false, "input"),
    extracting,
  ]);
  let { snap, picked } = early;
  value ??= extracted ?? undefined;
  if (value === undefined) return fallback("fill_value_not_extracted");
  if (extracting && ctx.ready && picked.target) {
    const guard = await staysPut(ctx.deps, snap, picked.target, false);
    if (guard.verdict !== "ok") {
      ctx.trace.push({ node: "not_ready", ms: 0, why: guard.verdict, after: "extract_text" });
      ctx.ready = false;
      ({ snap, picked } = await pickWhenReady(ctx, pick, false, "input"));
    }
  }
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = picked.target;

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  const expectedValue = substituteVariables(value, ctx.deps.variables);
  let filled = await act(
    ctx,
    { selector, description: describeLine(target), method: "fill", arguments: [value] },
    { expectedValue },
  );
  if (isDetached(filled)) {
    const fresh = await snapshot(ctx.deps);
    const again = await pickTarget(
      ctx,
      "target_reacquired",
      fresh,
      ["input", "broad"],
      "Which field should the text be entered into?",
      {
        quotedTargets: quotedStrings(ctx.instruction).filter((quoted) => quoted !== value),
      },
    );
    const freshSelector = again.target ? selectorFor(fresh, again.target) : undefined;
    if (again.target && freshSelector) {
      filled = await act(
        ctx,
        {
          selector: freshSelector,
          description: describeLine(again.target),
          method: "fill",
          arguments: [value],
        },
        { expectedValue },
      );
    }
  }
  if (filled.kind === "fallback") return filled;

  const afterTyping = choiceAnswer(intent, "after_typing");
  if (afterTyping.choice !== "pick_suggestion" || afterTyping.confidence < ctx.threshold)
    return filled;
  const chosen = await chooseFromAppeared(
    ctx,
    snap,
    target.id,
    "suggestion",
    "Which suggestion or autocomplete option does the instruction ask to choose?",
    "wait",
  );
  if (chosen.kind === "nothing_appeared")
    return fallback("suggestion_none_appeared", filled.result.actions);
  if (chosen.kind === "fallback")
    return fallback(chosen.reason, filled.result.actions, chosen.focusIds);
  return merge(filled, chosen);
}
