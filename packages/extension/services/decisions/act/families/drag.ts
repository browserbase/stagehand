import { pickTarget } from "../../pick.js";
import { addDomHints } from "../domHints.js";
import { fallback } from "../outcomes.js";
import { describeLine, selectorFor, snapshot } from "../page.js";
import { act, rejected } from "../perform.js";
import type { DecisionsActOutcome, PipelineContext } from "../types.js";

/** Drag and drop: pick the source and the destination. */

export async function runDrag(ctx: PipelineContext): Promise<DecisionsActOutcome> {
  const snap = await snapshot(ctx.deps);
  await addDomHints(ctx, snap);
  // Source and destination are independent questions over the same page.
  const [source, destination] = await Promise.all([
    pickTarget(
      ctx,
      "drag_source",
      snap,
      ["broad", "pointer"],
      "Which element does the instruction ask to drag?",
      {
        quotedTargets: [],
      },
    ),
    pickTarget(
      ctx,
      "drag_destination",
      snap,
      ["broad", "pointer"],
      "Onto which element does the instruction ask to drop the dragged element?",
      { quotedTargets: [] },
    ),
  ]);
  if (!source.target) return await rejected(ctx, snap, "drag_source_rejected", source);
  if (!destination.target)
    return await rejected(ctx, snap, "drag_destination_rejected", destination);
  if (source.target.id === destination.target.id) return fallback("drag_same_element");

  const from = selectorFor(snap, source.target);
  const to = selectorFor(snap, destination.target);
  if (!from || !to) return fallback("target_missing_xpath:drag");
  return await act(
    ctx,
    {
      selector: from,
      description: `drag ${describeLine(source.target)} onto ${describeLine(destination.target)}`,
      method: "dragAndDrop",
      arguments: [to],
    },
    { before: snap },
  );
}
