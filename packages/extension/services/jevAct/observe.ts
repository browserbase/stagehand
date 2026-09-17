import type { Action, Variables } from "@browserbasehq/stagehand-protocol/types";
import type { StagehandLogger } from "../../logger.js";
import type { Page } from "../../understudy/page.js";
import { trimTrailingTextNode } from "../../utils.js";
import {
  fillValueCandidates,
  matchOption,
  parseKey,
  parsePercent,
  quotedStrings,
  redactor,
} from "./args.js";
import {
  annotate,
  ask,
  pickTarget,
  round,
  type AskContext,
  type Snapshot,
  type TraceEntry,
} from "./pick.js";
import { FAMILIES, KEYS, POINTER_METHODS, SCROLL_METHODS, resolveFamily } from "./pipeline.js";
import {
  buildView,
  describeCandidate,
  markEditable,
  nativeSelectOptions,
  parseOutline,
  type OutlineNode,
  type ViewKind,
} from "./tree.js";
import { choiceAnswer, noulAnswer, type JevConfig } from "./typesafeClient.js";

/**
 * Experimental observe() on Jev. observe() answers "which element(s), and how
 * would you act on them" — the same decisions act() makes, minus the action —
 * so it reuses the act tree: intent → candidates → pick. "Find all …"
 * instructions become one yes/no per candidate, asked in a single request.
 */

export type JevObserveDeps = {
  page: Pick<Page, "captureSnapshot">;
  logger: StagehandLogger;
  /** Undefined means "everything a user could act on". */
  instruction?: string;
  variables?: Variables;
  snapshotOptions: Parameters<Page["captureSnapshot"]>[0];
  ensureTimeRemaining: () => void;
};

export type JevObserveOutcome =
  | { kind: "done"; actions: Action[] }
  | { kind: "fallback"; reason: string };

const LOCATE = "locate";
const OBSERVE_FAMILIES: Record<string, string> = {
  ...FAMILIES,
  [LOCATE]:
    "Only find or locate something on the page (a heading, a section, a piece of text) with no interaction described",
};
const MAX_ALL_ELEMENTS = 400;
const RELEVANCE_BATCH = 60;
const RELEVANCE_MAX = 600;
const RELEVANT_ABOVE = 0.6;

export async function runJevObserve(
  config: JevConfig & { actConfidence?: number },
  deps: JevObserveDeps,
): Promise<JevObserveOutcome> {
  const trace: TraceEntry[] = [];
  const finish = (outcome: JevObserveOutcome): JevObserveOutcome => {
    // A result assembled after the deadline is still a timeout.
    deps.ensureTimeRemaining();
    deps.logger.info("Jev observe pipeline finished", {
      category: "jev",
      instruction: deps.instruction ?? "",
      outcome: outcome.kind,
      reason: outcome.kind === "fallback" ? outcome.reason : "",
      results: outcome.kind === "done" ? outcome.actions.length : 0,
      trace: JSON.stringify(trace),
    });
    return outcome;
  };

  const snap = await snapshot(deps);

  // No instruction: every interactive element, no model needed.
  if (!deps.instruction) {
    const everything = uniqueById([
      ...buildView(snap.nodes, "pointer"),
      ...buildView(snap.nodes, "input"),
      ...buildView(snap.nodes, "select"),
    ]).sort((a, b) => a.index - b.index);
    trace.push({ node: "all_interactive", ms: 0, options: everything.length });
    // Never a silently shortened "everything": past the cap the LLM decides what matters.
    if (everything.length > MAX_ALL_ELEMENTS)
      return finish({ kind: "fallback", reason: `too_many_elements:${everything.length}` });
    return finish({ kind: "done", actions: toActions(snap, everything, undefined, deps) });
  }

  const ctx: AskContext = {
    config,
    instruction: deps.instruction,
    trace,
    threshold: config.actConfidence ?? 0.7,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
    // A value an earlier act typed from %variables% is on the page by now.
    redact: redactor(deps.variables),
  };

  const intent = await ask(
    ctx,
    "intent",
    { instruction: deps.instruction },
    {
      family: {
        type: "choice",
        instructions: "Which kind of browser action does the instruction describe or imply?",
        criteria: OBSERVE_FAMILIES,
      },
      cardinality: {
        type: "choice",
        instructions: "How many elements does the instruction ask for?",
        criteria: {
          one: "A single specific element",
          several: "Several elements, or all elements of some kind",
        },
      },
      key: {
        type: "choice",
        instructions: "If the instruction asks to press a keyboard key, which key?",
        criteria: {
          ...Object.fromEntries(KEYS.map((key) => [key, `The ${key} key`])),
          other: "Some other key, or the instruction is not a key press",
        },
      },
    },
  );
  const family = resolveFamily(choiceAnswer(intent, "family"), ctx.threshold);
  const cardinality = choiceAnswer(intent, "cardinality");
  annotate(trace, {
    choice: family.choice,
    confidence: family.confidence,
    top: family.top,
    cardinality: cardinality.choice,
  });
  if (family.confidence < ctx.threshold)
    return finish({ kind: "fallback", reason: `intent_low_confidence:${family.top}` });
  if (["not_an_action", "unsupported", "drag"].includes(family.choice)) {
    return finish({ kind: "fallback", reason: `unsupported_family:${family.choice}` });
  }

  if (family.choice === "press") {
    const answer = choiceAnswer(intent, "key");
    const key =
      answer.choice !== "other" && answer.confidence >= ctx.threshold
        ? answer.choice
        : parseKey(deps.instruction);
    if (!key) return finish({ kind: "fallback", reason: "press_no_key" });
    return finish({
      kind: "done",
      actions: [
        { selector: "xpath=/html", description: `press ${key}`, method: "press", arguments: [key] },
      ],
    });
  }

  const kinds = viewsFor(family.choice);
  const several = cardinality.choice === "several" && cardinality.confidence >= ctx.threshold;
  if (!several) {
    const picked = await pickTarget(
      ctx,
      "target",
      snap,
      kinds,
      "Which element does the instruction refer to?",
      {
        quotedTargets: quotedStrings(deps.instruction).filter(
          (quoted) =>
            !fillValueCandidates(deps.instruction!, deps.variables).includes(quoted) ||
            family.choice !== "fill",
        ),
      },
    );
    if (!picked.target)
      return finish({ kind: "fallback", reason: `target_rejected:${picked.reason}` });
    return finish({ kind: "done", actions: toActions(snap, [picked.target], family.choice, deps) });
  }

  // "Find all …": an independent yes/no per candidate, fanned out in as few
  // requests as fit. Lexical scoring only orders the list when it must be cut.
  const candidates = uniqueById(kinds.flatMap((kind) => buildView(snap.nodes, kind)));
  if (candidates.length === 0) return finish({ kind: "fallback", reason: "no_candidates" });
  // "All" means all: every candidate gets its yes/no, or Jev does not answer.
  if (candidates.length > RELEVANCE_MAX) {
    return finish({ kind: "fallback", reason: `too_many_candidates:${candidates.length}` });
  }
  const considered = candidates;
  const batches: OutlineNode[][] = [];
  for (let at = 0; at < considered.length; at += RELEVANCE_BATCH)
    batches.push(considered.slice(at, at + RELEVANCE_BATCH));

  const relevant: OutlineNode[] = [];
  await Promise.all(
    batches.map(async (batch, index) => {
      const response = await ask(
        ctx,
        `relevance:batch_${index}`,
        { instruction: deps.instruction! },
        Object.fromEntries(
          batch.map((candidate) => [
            candidate.id,
            {
              type: "noul" as const,
              instructions: {
                question: "Is this element one of the elements the instruction asks for?",
                element: describeCandidate(snap.nodes, candidate),
              },
            },
          ]),
        ),
      );
      for (const candidate of batch) {
        if (round(noulAnswer(response, candidate.id).noul) >= RELEVANT_ABOVE)
          relevant.push(candidate);
      }
    }),
  );
  trace.push({ node: "relevance", ms: 0, options: considered.length, relevant: relevant.length });
  if (relevant.length === 0) return finish({ kind: "fallback", reason: "none_relevant" });
  relevant.sort((a, b) => a.index - b.index);
  return finish({ kind: "done", actions: toActions(snap, relevant, family.choice, deps) });
}

function viewsFor(family: string): ViewKind[] {
  if (family === "fill") return ["input", "broad"];
  if (family === "select") return ["select", "broad"];
  if (family in SCROLL_METHODS) return ["scroll"];
  // Locating: readable text first; nameless inputs and controls only show up in their own views.
  if (family === LOCATE) return ["text", "input", "pointer"];
  return ["pointer", "broad"];
}

/** Method and arguments per element: from the intent when there is one, else from the element's role. */
function toActions(
  snap: Snapshot,
  nodes: OutlineNode[],
  family: string | undefined,
  deps: JevObserveDeps,
): Action[] {
  const actions: Action[] = [];
  for (const node of nodes) {
    const xpath = trimTrailingTextNode(snap.xpathMap[node.id]);
    if (!xpath) continue;
    const role = node.role.toLowerCase();
    const options = nativeSelectOptions(snap.nodes, node);
    let method = "click";
    let args: string[] = [];

    if (family && family in SCROLL_METHODS) {
      method = SCROLL_METHODS[family]!;
      const percent = deps.instruction ? parsePercent(deps.instruction) : undefined;
      if (method === "scrollTo") args = [percent ?? "50%"];
    } else if (family && family in POINTER_METHODS) {
      // An explicit "hover over / click the Country dropdown" is what it says,
      // even on a native <select>; the role only decides when intent does not.
      method = POINTER_METHODS[family]!;
    } else if (options.length > 0) {
      method = "selectOptionFromDropdown";
      const option = deps.instruction
        ? matchOption(options, deps.instruction, node.name)
        : undefined;
      args = option ? [option] : [];
    } else if (
      family === "fill" ||
      (!family && (node.editable || /\b(textbox|searchbox|spinbutton|textarea)\b/.test(role)))
    ) {
      method = "fill";
      // Only a value that cannot be the field's own label; never a made-up one.
      const values = (
        deps.instruction ? fillValueCandidates(deps.instruction, deps.variables) : []
      ).filter((value) => value.trim().toLowerCase() !== node.name.trim().toLowerCase());
      args = values.length === 1 ? [values[0]!] : [];
    }

    actions.push({
      selector: `xpath=${xpath}`,
      description: node.name ? `${node.role}: ${node.name}` : node.role,
      method,
      arguments: args,
    });
  }
  return actions;
}

function uniqueById(nodes: OutlineNode[]): OutlineNode[] {
  const seen = new Set<string>();
  return nodes.filter((node) => (seen.has(node.id) ? false : (seen.add(node.id), true)));
}

async function snapshot(deps: JevObserveDeps): Promise<Snapshot> {
  deps.ensureTimeRemaining();
  const { combinedTree, combinedXpathMap, combinedEditableIds } = await deps.page.captureSnapshot(
    deps.snapshotOptions,
  );
  const nodes = parseOutline(combinedTree);
  markEditable(nodes, combinedEditableIds);
  return { tree: combinedTree, xpathMap: combinedXpathMap as Record<string, string>, nodes };
}
