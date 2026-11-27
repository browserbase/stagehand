import { matchOption } from "../../args.js";
import { choiceAnswer } from "../../client.js";
import { annotate, ask, NONE, pickTarget } from "../../pick.js";
import { nativeSelectOptions, selectedNativeOptions } from "../../tree.js";
import { chooseFromAppeared, EDITABLE_ROLES } from "../choices.js";
import { fallback, merge } from "../outcomes.js";
import { describeLine, selectorFor, snapshot } from "../page.js";
import { act, optionText, rejected } from "../perform.js";
import type { DecisionsActOutcome, Done, PipelineContext } from "../types.js";

const LEAF_CHOICE_ROLES =
  /\b(option|menuitem|menuitemradio|menuitemcheckbox|radio|checkbox|switch|tab|treeitem)\b/i;

const SELF_CONTAINED_CHOICE = /\b(gridcell|cell|link|image|img|listitem)\b/i;

const MAX_NATIVE_OPTIONS = 254;

export async function runSelect(ctx: PipelineContext): Promise<DecisionsActOutcome> {
  const snap = await snapshot(ctx.deps);
  const picked = await pickTarget(
    ctx,
    "target",
    snap,
    ["select", "broad"],
    "Which dropdown, combobox, or select control does the instruction refer to?",
  );
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = picked.target;
  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);

  const options = nativeSelectOptions(snap.nodes, target);
  if (options.length > 0) {
    let option = matchOption(options, ctx.instruction, target.name);
    if (!option) {
      if (options.length > MAX_NATIVE_OPTIONS) return fallback("select_too_many_options");
      const response = await ask(
        ctx,
        "argument",
        { instruction: ctx.instruction },
        {
          option: {
            type: "choice",
            instructions:
              "Which option does the instruction ask to choose? A quoted dropdown name or placeholder is NOT the option to choose.",
            criteria: {
              ...Object.fromEntries(
                options.map((candidate, index) => [`option_${index}`, candidate]),
              ),
              [NONE]: "None of these options matches the instruction",
            },
          },
        },
      );
      const answer = choiceAnswer(response, "option");
      annotate(ctx.trace, { choice: answer.choice, confidence: answer.confidence });
      if (answer.choice === NONE || answer.confidence < ctx.threshold) {
        return fallback(`select_option_low_confidence:${answer.choice}@${answer.confidence}`);
      }
      option = options[Number(answer.choice.slice("option_".length))]!;
    }
    const selected = await act(
      ctx,
      {
        selector,
        description: describeLine(target),
        method: "selectOptionFromDropdown",
        arguments: [option],
      },
      { before: snap },
    );
    if (selected.kind === "fallback" || ctx.config.verify === "off") return selected;

    const after = await snapshot(ctx.deps);
    const refreshed = after.nodes.find((node) => node.id === target.id);
    const matched = refreshed
      ? selectedNativeOptions(after.nodes, refreshed).includes(option)
      : undefined;
    ctx.trace.push({ node: "verify_select", ms: 0, match: matched ?? null });
    return matched === false ? fallback("select_readback_mismatch") : selected;
  }

  if (LEAF_CHOICE_ROLES.test(target.role)) {
    return await act(
      ctx,
      { selector, description: describeLine(target), method: "click", arguments: [] },
      { before: snap, target },
    );
  }

  const expand = await act(ctx, {
    selector,
    description: describeLine(target),
    method: "click",
    arguments: [],
  });
  if (expand.kind === "fallback") return expand;

  const question = "Which element is the option the instruction asks to choose?";
  const selfContained = SELF_CONTAINED_CHOICE.test(target.role);
  const patience = selfContained ? "once" : "wait";
  let chosen = await chooseFromAppeared(ctx, snap, target.id, "option", question, patience);
  let done: Done = expand;

  if (chosen.kind === "nothing_appeared" && EDITABLE_ROLES.test(target.role)) {
    const text = await optionText(ctx, target);
    if (text) {
      const typed = await act(ctx, {
        selector,
        description: describeLine(target),
        method: "fill",
        arguments: [text],
      });
      if (typed.kind === "fallback") return fallback(typed.reason, expand.result.actions);
      done = merge(expand, typed);
      chosen = await chooseFromAppeared(ctx, snap, target.id, "option", question, "wait");
    }
  }

  if (chosen.kind === "nothing_appeared") {
    return selfContained ? done : fallback("option_none_appeared", done.result.actions);
  }
  if (chosen.kind === "fallback")
    return fallback(chosen.reason, done.result.actions, chosen.focusIds);
  return merge(done, chosen);
}
