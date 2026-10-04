import { parseKey } from "../../args.js";
import { choiceAnswer, type DecisionResponse } from "../../client.js";
import { fallback } from "../outcomes.js";
import { act } from "../perform.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

/** Key presses: the key comes from the intent answer, so there is nothing to pick. */

export async function runPress(
  ctx: PipelineContext,
  intent: DecisionResponse,
): Promise<DecisionsActOutcome> {
  const keyAnswer = choiceAnswer(intent, "key");
  const key =
    keyAnswer.choice !== "other" && keyAnswer.confidence >= ctx.threshold
      ? keyAnswer.choice
      : parseKey(ctx.instruction);
  if (!key) return fallback("press_no_key");

  return await act(ctx, {
    selector: "xpath=/html",
    description: `press ${key}`,
    method: "press",
    arguments: [key],
  });
}
