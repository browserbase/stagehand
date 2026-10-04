import { isLoneVariable, quotedStrings, substituteVariables } from "../../args.js";
import { choiceAnswer, type DecisionResponse } from "../../client.js";
import { NONE, pickTarget } from "../../pick.js";
import { chooseFromAppeared } from "../choices.js";
import { fallback, isDetached, merge } from "../outcomes.js";
import { describeLine, selectorFor, snapshot } from "../page.js";
import { act, extractText, rejected } from "../perform.js";
import { pickWhenReady } from "../readiness.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

/** Typing into a field, including fields that then offer suggestions to choose from. */

export async function runFill(
  ctx: PipelineContext,
  intent: DecisionResponse,
  values: string[],
): Promise<DecisionsActOutcome> {
  // The text to type: a lone declared %variable% (never a label), else the decision model's
  // choice among quoted strings, else an argument-only LLM call for unquoted text.
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

  const [{ snap, picked }, extracted] = await Promise.all([
    pickWhenReady(
      ctx,
      (candidate) =>
        pickTarget(
          ctx,
          "target",
          candidate,
          ["input", "broad"],
          "Which field should the text be entered into?",
          {
            quotedTargets: quotedStrings(ctx.instruction).filter((quoted) => quoted !== value),
          },
        ),
      false,
      "input",
    ),
    extracting,
  ]);
  value ??= extracted ?? undefined;
  if (value === undefined) return fallback("fill_value_not_extracted");
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
  // Search boxes that swap themselves for a richer widget on focus leave the
  // picked node detached; the same question over a fresh snapshot finds the new one.
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

  // "…and pick the suggestion": choose among what the typing made appear.
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
  // The instruction asked for a suggestion and none was chosen: that is not a
  // success to report. The LLM path gets the page as it now is.
  if (chosen.kind === "nothing_appeared")
    return fallback("suggestion_none_appeared", filled.result.actions);
  if (chosen.kind === "fallback")
    return fallback(chosen.reason, filled.result.actions, chosen.focusIds);
  return merge(filled, chosen);
}
