import { choiceAnswer, type DecisionResponse } from "../../client.js";
import { pickTarget } from "../../pick.js";
import { addDomHints, preferVisibleTwin } from "../domHints.js";
import { fallback, merge } from "../outcomes.js";
import { describeLine, selectorFor } from "../page.js";
import { act, beginEffectProbe, rejected } from "../perform.js";
import { pickWhenReady } from "../readiness.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

/** click, double click and hover: pick the target, act, and retry a runner-up when a click provably did nothing. */

const CHECKABLE_ROLES = /\b(checkbox|switch|radio|menuitemcheckbox|menuitemradio)\b/i;

/** A runner-up at least this likely makes a no-effect click worth retrying on it. */
const RETRY_RUNNER_UP = 0.2;

export async function runPointer(
  ctx: PipelineContext,
  method: string,
  intent: DecisionResponse,
): Promise<DecisionsActOutcome> {
  const button = choiceAnswer(intent, "mouse_button");
  if (button.confidence < ctx.threshold) return fallback(`mouse_button_unsure:${button.choice}`);
  const buttonArgs = method === "click" && button.choice !== "left" ? [button.choice] : [];

  const { snap, picked } = await pickWhenReady(
    ctx,
    (candidate) => {
      // DOM hints cost a CDP round trip per nameless control: only when the decision model is
      // actually about to be asked about them.
      ctx.prepare = () => addDomHints(ctx, candidate);
      return pickTarget(
        ctx,
        "target",
        candidate,
        ["pointer", "broad"],
        `Which element should receive the ${method} to carry out the instruction?`,
      );
    },
    true,
    "pointer",
  );
  if (!picked.target) return await rejected(ctx, snap, "target_rejected", picked);
  const target = await preferVisibleTwin(ctx, snap, picked.target);

  // "Make sure X is checked" on a checked box: a click would undo it.
  const desired = choiceAnswer(intent, "toggle_state");
  if (
    method === "click" &&
    CHECKABLE_ROLES.test(target.role) &&
    desired.choice !== "unspecified" &&
    desired.confidence >= ctx.threshold
  ) {
    const isOn = target.flags.includes("checked") || target.flags.includes("selected");
    ctx.trace.push({
      node: "toggle_state",
      ms: 0,
      desired: desired.choice,
      current: isOn ? "on" : "off",
    });
    if (isOn === (desired.choice === "on")) {
      return {
        kind: "done",
        result: {
          success: true,
          message: `No action needed: ${describeLine(target)} is already ${desired.choice}`,
          actionDescription: describeLine(target),
          actions: [],
        },
      };
    }
  }

  const selector = selectorFor(snap, target);
  if (!selector) return fallback(`target_missing_xpath:${target.id}`);
  const action = { selector, description: describeLine(target), method, arguments: buttonArgs };

  if (method !== "click" || !ctx.config.retryNoEffect || ctx.config.verify === "off") {
    return await act(ctx, action, { before: snap, target });
  }

  // Opt-in (retryNoEffect): when the click provably changed nothing and the decision model had
  // a credible second choice, try that one. The decision model's pre-visibility pick is a copy
  // of the same control, never a "runner-up".
  const runnerUp = picked.ranked.find(
    (entry) =>
      entry.id !== target.id && entry.id !== picked.target!.id && entry.p >= RETRY_RUNNER_UP,
  );
  if (!runnerUp) return await act(ctx, action, { before: snap, target });

  const probe = beginEffectProbe(ctx);
  const first = await act(ctx, action, { before: snap, target });
  if (first.kind === "fallback") return first;
  const after = await probe.unchanged(snap);
  if (!after) return first;

  // Re-resolve the runner-up in the fresh snapshot: a positional XPath from
  // before the click may now point at a different element.
  const before = snap.nodes.find((node) => node.id === runnerUp.id);
  const retryNode = after.nodes.find((node) => node.id === runnerUp.id);
  const retrySelector = retryNode ? selectorFor(after, retryNode) : undefined;
  if (
    !before ||
    !retryNode ||
    !retrySelector ||
    retryNode.role !== before.role ||
    retryNode.name !== before.name
  ) {
    return first;
  }
  ctx.trace.push({ node: "retry_runner_up", ms: 0, choice: retryNode.id, p: runnerUp.p });
  const second = await act(ctx, {
    selector: retrySelector,
    description: describeLine(retryNode),
    method,
    arguments: buttonArgs,
  });
  // The first click provably did nothing and the retry failed: hand off with
  // the first action on record rather than report (and cache) a no-op.
  if (second.kind === "fallback") return { ...second, noCache: true };
  // Two clicks for one instruction is a recovery, not a recipe to replay.
  return { ...merge(first, second), noCache: true };
}
