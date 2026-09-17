import type { Action } from "@browserbasehq/stagehand-protocol/types";
import { trimTrailingTextNode } from "../../utils.js";
import { ask, round, type AskContext, type Snapshot } from "./pick.js";
import { describeCandidate } from "./tree.js";
import { noulAnswer } from "./typesafeClient.js";

/**
 * Cached actions replay blind: a selector that still resolves, but now points
 * at a different control, is acted on without any model in the loop. One Jev
 * yes/no over the element the cached selector resolves to catches that before
 * the replay instead of after.
 */
export type CacheVerdict =
  | { verdict: "match"; score: number }
  | { verdict: "stale"; score: number; found: string }
  /** Selector not present in the snapshot; the replay itself will surface that. */
  | { verdict: "unknown" };

const STALE_BELOW = 0.35;

export async function checkCachedAction(
  ctx: AskContext,
  snap: Snapshot,
  action: Action,
): Promise<CacheVerdict> {
  const wanted = normalizeXpath(action.selector);
  const id = Object.entries(snap.xpathMap).find(
    ([, xpath]) => normalizeXpath(xpath) === wanted,
  )?.[0];
  const node = id ? snap.nodes.find((candidate) => candidate.id === id) : undefined;
  if (!node) {
    ctx.trace.push({ node: "cache_check", ms: 0, verdict: "unknown" });
    return { verdict: "unknown" };
  }

  const element = describeCandidate(snap.nodes, node);
  const response = await ask(
    ctx,
    "cache_check",
    {
      instruction: ctx.instruction,
      cached_action: { method: action.method ?? "", description: action.description },
      element_now_at_cached_selector: element,
    },
    {
      still_matches: {
        type: "noul",
        instructions:
          "Is the element now at the cached selector still the element the cached action and the instruction refer to?",
      },
    },
  );
  const score = round(noulAnswer(response, "still_matches").noul);
  const stale = score < STALE_BELOW;
  ctx.trace[ctx.trace.length - 1]!.score = score;
  ctx.trace[ctx.trace.length - 1]!.verdict = stale ? "stale" : "match";
  return stale
    ? { verdict: "stale", score, found: `${node.role}${node.name ? `: ${node.name}` : ""}` }
    : { verdict: "match", score };
}

/**
 * Both sides in one shape: cached press/scroll actions use `xpath=/html` while
 * the snapshot map records the same element as `/html[1]`, so every step
 * without an index gets `[1]`.
 */
function normalizeXpath(selector: string): string {
  const xpath = selector.replace(/^xpath=/i, "").trim();
  return (trimTrailingTextNode(xpath) ?? xpath)
    .replace(/\/+$/, "")
    .toLowerCase()
    .replace(/\/([a-z][\w-]*)(?=\/|$)/g, "/$1[1]");
}
