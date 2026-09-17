import type { StagehandLogger } from "../../logger.js";
import { quotedStrings } from "./args.js";
import { shortlistWithBm25 } from "./bm25.js";
import {
  buildView,
  describeCandidate,
  exactNameMatches,
  nearbyTwins,
  type OutlineNode,
  type ViewKind,
} from "./tree.js";
import {
  choiceAnswer,
  noulAnswer,
  systemOne,
  type JevConfig,
  type JevQuestion,
  type JevResponse,
  type JsonValue,
} from "./typesafeClient.js";

export type TraceEntry = Record<string, JsonValue>;

export type Snapshot = {
  tree: string;
  xpathMap: Record<string, string>;
  nodes: OutlineNode[];
};

export type AskContext = {
  config: JevConfig;
  instruction: string;
  trace: TraceEntry[];
  threshold: number;
  logger: StagehandLogger;
  ensureTimeRemaining: () => void;
  /** DOM attribute hints for nameless candidates, keyed by node id. */
  domHints?: Map<string, string>;
  /** Called once per tier right before Jev is asked, e.g. to fetch DOM hints only when needed. */
  prepare?: (candidates: OutlineNode[]) => Promise<void>;
  /**
   * Applied to everything sent to TypeSafe and to the trace. Values an earlier
   * act typed from %variables% are on the page by now; they must not leave it.
   */
  redact?: (text: string) => string;
};

export type Pick = {
  picked?: OutlineNode;
  accepted: boolean;
  best: number;
  none: number;
  choice: string;
  /** Candidates by descending probability; feeds retries and the focused LLM fallback. */
  ranked: Array<{ id: string; p: number }>;
  via: "shortcut" | "jev";
};

export type TargetResult = {
  target?: OutlineNode;
  reason: string;
  ranked: Array<{ id: string; p: number }>;
  /** The shortlist is worth showing to the LLM fallback instead of the whole page. */
  credible: boolean;
  /** Strict's none-of-these probability on the last ask: high means "not on this page". */
  none: number;
};

export const NONE = "none_match";
const NONE_DESCRIPTION = "None of these elements matches the instruction";
/** Strict's none-of-these only vetoes the best pick above this probability. */
const NONE_VETO = 0.9;
const SHARD_SIZE = 254;
const FINALISTS_PER_SHARD = 3;
/** ~4 chars/token against Jev's ~32K-token request limit, with headroom. */
const SHARD_CHAR_BUDGET = 60_000;
/** Parallel shard requests per pick; pages needing more go to the LLM. */
const MAX_SHARDS = 8;
/** Above this many candidates, a lexically pruned list is tried first. */
const PRUNE_ABOVE = 40;
const PRUNE_KEEP = 30;
/** Accepted picks with strict's none above this are held while a later tier gets a chance. */
const NONE_UNEASY = 0.5;
const CREDIBLE_TOP = 0.5;
const SURE_ENOUGH = 0.5;
const NONE_CERTAIN = 0.1;
/** A held pick is only acted on below this; above it strict is saying "not here". */
const HELD_NONE_MAX = 0.7;
const CLEAR_LEADER = 0.6;
const LEADER_RATIO = 2.5;

export async function ask(
  ctx: AskContext,
  node: string,
  state: JsonValue,
  questions: Record<string, JevQuestion>,
): Promise<JevResponse> {
  ctx.ensureTimeRemaining();
  if (ctx.redact) {
    const redacted = JSON.parse(ctx.redact(JSON.stringify({ state, questions }))) as {
      state: JsonValue;
      questions: Record<string, JevQuestion>;
    };
    state = redacted.state;
    questions = redacted.questions;
  }
  const response = await systemOne(ctx.config, state, questions);
  ctx.trace.push({
    node,
    ms: response.durationMs,
    questions: Object.keys(questions).length,
    inputTokens: response.usage.inputTokens,
  });
  return response;
}

export function annotate(trace: TraceEntry[], data: TraceEntry): void {
  const last = trace[trace.length - 1];
  if (last) Object.assign(last, data);
}

/**
 * Resolves a target through tiered views: the family's role-filtered view
 * first, then a broad view of every named node (custom widgets built from
 * plain divs only show up there). Within a tier, large lists are first cut to
 * the candidates that share words with the instruction, so the common case is
 * one Jev request; the full list is only asked when that pruned pick is rejected.
 */
export async function pickTarget(
  ctx: AskContext,
  node: string,
  snap: Snapshot,
  kinds: ViewKind[],
  instructions: string,
  options: { filter?: (candidate: OutlineNode) => boolean; quotedTargets?: string[] } = {},
): Promise<TargetResult> {
  let reason = "no_candidates";
  let ranked: TargetResult["ranked"] = [];
  let held: Pick | undefined;
  let lastNone = 1;
  const seen = new Set<string>();
  const result = (pick: Pick | undefined): TargetResult => {
    // A held pick is a fallback of last resort; when strict leaned hard toward
    // "none of these", acting on it is how the wrong modal button got clicked.
    const usable = held && held.none <= HELD_NONE_MAX ? held : undefined;
    const chosen = pick ?? usable;
    const shortlist = chosen?.ranked ?? ranked;
    return {
      ...(chosen?.picked ? { target: chosen.picked } : {}),
      reason: chosen?.picked ? "" : reason,
      ranked: shortlist,
      credible: (shortlist[0]?.p ?? 0) >= CREDIBLE_TOP,
      none: chosen ? chosen.none : lastNone,
    };
  };

  for (const kind of kinds) {
    const candidates = buildView(snap.nodes, kind).filter(options.filter ?? (() => true));
    const signature = candidates.map((candidate) => candidate.id).join(",");
    if (candidates.length === 0 || seen.has(signature)) continue;
    seen.add(signature);

    // Exactly one quoted target and exactly one candidate carrying that exact
    // name: no ranking needed, but the quote may only be an anchor ("the link
    // below 'Pricing'"), so Jev still confirms that one candidate (a ~400-token
    // request instead of the full list).
    const quoted = options.quotedTargets ?? quotedStrings(ctx.instruction);
    if (quoted.length === 1) {
      const exact = exactNameMatches(candidates, quoted[0]!);
      if (exact.length === 1) {
        const confirm = await pickCandidate(
          ctx,
          `${node}:${kind}:exact_name`,
          snap,
          exact,
          instructions,
        );
        if (confirm.picked && confirm.accepted && confirm.none <= NONE_UNEASY)
          return result(confirm);
      }
    }
    await ctx.prepare?.(candidates);

    const attempts: OutlineNode[][] = [];
    if (candidates.length > PRUNE_ABOVE) {
      const pruned = shortlistWithBm25(snap.nodes, candidates, ctx.instruction, PRUNE_KEEP);
      if (pruned.length > 0 && pruned.length < candidates.length) attempts.push(pruned);
    }
    attempts.push(candidates);

    for (const [index, attempt] of attempts.entries()) {
      const label = `${node}:${kind}${attempts.length > 1 && index === 0 ? ":pruned" : ""}`;
      // The broad tier is a last look, not worth a multi-request fan-out: one
      // such act spent 169K Jev tokens to conclude nothing matched.
      const pick = await pickCandidate(ctx, label, snap, attempt, instructions, kind !== "broad");
      lastNone = pick.none;
      if (pick.ranked.length > 0) ranked = pick.ranked;
      if (pick.picked && pick.accepted) {
        if (pick.none <= NONE_UNEASY) return result(pick);
        // Good enough to act on, but strict suspects the real target is not in
        // this view (a modal's "Close" is plain text): let the next tier try.
        if (!held || pick.best - pick.none > held.best - held.none) held = pick;
        break;
      }
      reason = `${kind}:${pick.choice}@best=${pick.best},none=${pick.none}`;
      // Jev saw plausible targets and could not choose between them. A wider
      // list will not make that easier; stop here and hand over the shortlist.
      if (pick.picked && pick.none < NONE_UNEASY) return result(undefined);
    }
  }
  return result(undefined);
}

/**
 * Two questions fan out in one request: `best` ranks the candidates with no
 * escape hatch, `strict` adds a none-of-these option. Loosely worded
 * instructions ("the input field") make a lone strict question hedge toward
 * none, so strict only vetoes when it is nearly certain nothing matches.
 */
export async function pickCandidate(
  ctx: AskContext,
  node: string,
  snap: Snapshot,
  candidates: OutlineNode[],
  instructions: string,
  allowShards = true,
): Promise<Pick> {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const describe = (option: OutlineNode) =>
    describeCandidate(snap.nodes, option, ctx.domHints?.get(option.id));
  const state = { instruction: ctx.instruction };
  const rejected = (choice: string): Pick => ({
    accepted: false,
    best: 0,
    none: 1,
    choice,
    ranked: [],
    via: "jev",
  });

  let finalists = candidates;
  const shards = shardByBudget(
    candidates,
    (candidate) => JSON.stringify(describe(candidate)).length,
  );
  if (shards.length > (allowShards ? MAX_SHARDS : 1)) {
    ctx.trace.push({
      node: `${node}:too_many`,
      ms: 0,
      options: candidates.length,
      shards: shards.length,
    });
    return rejected("too_many_candidates");
  }
  if (shards.length > 1) {
    // Too many options (or tokens) for one question: every shard nominates its
    // top candidates in parallel, then the finalists go through the real pick.
    const responses = await Promise.all(
      shards.map((shard, index) =>
        ask(ctx, `${node}:shard_${index}`, state, {
          shard: {
            type: "choice",
            instructions,
            criteria: {
              ...Object.fromEntries(shard.map((option) => [option.id, describe(option)])),
              [NONE]: NONE_DESCRIPTION,
            },
          },
        }),
      ),
    );
    finalists = responses
      .flatMap((response) =>
        Object.entries(choiceAnswer(response, "shard").probabilities)
          .filter(([id, probability]) => id !== NONE && probability >= 0.02)
          .sort((a, b) => b[1] - a[1])
          .slice(0, FINALISTS_PER_SHARD)
          .map(([id]) => byId.get(id))
          .filter((candidate): candidate is OutlineNode => candidate !== undefined),
      )
      .slice(0, SHARD_SIZE);
    ctx.trace.push({
      node: `${node}:finalists`,
      ms: 0,
      options: candidates.length,
      shards: shards.length,
      finalists: finalists.length,
    });
    if (finalists.length === 0) return rejected(NONE);
  }

  const criteria = Object.fromEntries(finalists.map((option) => [option.id, describe(option)]));
  const single = finalists.length === 1;
  const response = await ask(ctx, node, state, {
    strict: {
      type: "choice",
      instructions,
      criteria: { ...criteria, [NONE]: NONE_DESCRIPTION },
    },
    best: single
      ? {
          type: "noul",
          instructions: {
            question: "Is this element a plausible target for the instruction?",
            element: describe(finalists[0]!),
          },
        }
      : {
          type: "choice",
          instructions: {
            question: instructions,
            note: "Pick the best available element even if the wording does not match exactly.",
          },
          criteria,
        },
  });

  const strict = choiceAnswer(response, "strict");
  const none = round(strict.probabilities[NONE] ?? 0);
  let choice: string;
  let best: number;
  let ranked: Pick["ranked"];
  if (single) {
    choice = finalists[0]!.id;
    best = round(noulAnswer(response, "best").noul);
    ranked = [{ id: choice, p: best }];
  } else {
    const answer = choiceAnswer(response, "best");
    choice = answer.choice;
    best = round(answer.confidence);
    ranked = Object.entries(answer.probabilities)
      .filter(([id]) => byId.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, p]) => ({ id, p: round(p) }));
  }

  // Wrong picks in the eval runs came in at 0.9+ (a description problem, not a
  // confidence one), while split-but-right picks sat at 0.5–0.7 with strict
  // certain that something matches. Those are safe to take.
  // The relaxed rule needs a clear leader: a 0.56 vs 0.38 split between a link
  // and the toggle next to it was taken under a looser version, and was wrong.
  const leader = ranked[0]?.p ?? 0;
  const clearLeader = leader >= CLEAR_LEADER && leader >= LEADER_RATIO * (ranked[1]?.p ?? 0);
  let accepted =
    (best >= ctx.threshold && none <= NONE_VETO) ||
    (best >= SURE_ENOUGH && none <= NONE_CERTAIN && clearLeader);
  // The vote split between indistinguishable copies of one control (desktop
  // and mobile renderings of the same button): either is the answer.
  if (!accepted && none <= NONE_UNEASY && ranked.length > 1) {
    const [first, second] = ranked as [Pick["ranked"][number], Pick["ranked"][number]];
    const same = (id: string) => {
      const { occurrence: _occurrence, ...rest } = describe(byId.get(id)!);
      return JSON.stringify(rest);
    };
    // Same item only: identical "Delete" buttons in different rows look the
    // same to Jev too, and those are not interchangeable.
    const sameItem = nearbyTwins(snap.nodes, byId.get(first.id)!).some(
      (twin) => twin.id === second.id,
    );
    if (sameItem && first.p + second.p >= ctx.threshold && same(first.id) === same(second.id)) {
      accepted = true;
      choice = first.id;
    }
  }
  annotate(ctx.trace, {
    picked: byId.has(choice)
      ? (ctx.redact ?? ((text: string) => text))(JSON.stringify(describe(byId.get(choice)!)))
      : null,
    options: finalists.length,
    choice,
    best,
    none,
    strict: strict.choice,
    accepted,
    runner_up: ranked[1] ? `${ranked[1].id}@${ranked[1].p}` : null,
    // What Jev saw, so misses can be attributed to descriptions vs. the model.
    candidates: finalists
      .slice(0, 12)
      .map((option) =>
        (ctx.redact ?? ((text: string) => text))(
          JSON.stringify({ id: option.id, ...describe(option) }),
        ),
      ),
  });
  return { picked: byId.get(choice), accepted, best, none, choice, ranked, via: "jev" };
}

function shardByBudget<T>(items: T[], size: (item: T) => number): T[][] {
  const shards: T[][] = [];
  let current: T[] = [];
  let chars = 0;
  for (const item of items) {
    const cost = size(item) + 16;
    if (current.length > 0 && (current.length >= SHARD_SIZE || chars + cost > SHARD_CHAR_BUDGET)) {
      shards.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += cost;
  }
  if (current.length > 0) shards.push(current);
  return shards;
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
