import { choiceAnswer, type JsonValue, noulAnswer } from "../client.js";
import { annotate, ask, type AskContext, NONE, pickTarget, round } from "../pick.js";
import { buildView, type OutlineNode, pageDigest } from "../tree.js";
import type { Leaf } from "./plan.js";
import type { DecisionsExtractDeps } from "./types.js";
import { sameValue, valueOf } from "./values.js";

export const EXTRACT_CONFIDENCE = 0.45;

export async function readLeaf(
  ctx: AskContext,
  deps: DecisionsExtractDeps,
  leaf: Leaf,
): Promise<JsonValue | undefined> {
  if (leaf.kind === "boolean" || leaf.kind === "enum") return await judgeLeaf(ctx, deps, leaf);
  const node = await pickValueNode(ctx, deps, leaf, leaf.path.join("."));
  return node ? valueOf(deps, leaf, node) : undefined;
}

async function pickValueNode(
  ctx: AskContext,
  deps: DecisionsExtractDeps,
  leaf: Leaf,
  label: string,
): Promise<OutlineNode | undefined> {
  const usable = usableCandidates(
    deps,
    leaf,
    buildView(deps.snap.nodes, leaf.kind === "url" ? "link" : "text"),
  );
  const picked = await pickTarget(
    ctx,
    `field:${label}`,
    deps.snap,
    [leaf.kind === "url" ? "link" : "text"],
    leaf.kind === "url"
      ? "Which link is the one this field asks for?"
      : "Which element's own text IS the value of this field (not its label)?",
    { quotedTargets: [], filter: (node) => usable.has(node.id) },
  );
  if (picked.target) return picked.target;

  const [first, second] = picked.ranked;
  const node = (id: string | undefined) => deps.snap.nodes.find((candidate) => candidate.id === id);
  const a = node(first?.id);
  const b = node(second?.id);
  if (
    a &&
    b &&
    picked.none <= 0.5 &&
    first!.p + second!.p >= ctx.threshold &&
    sameValue(valueOf(deps, leaf, a), valueOf(deps, leaf, b))
  ) {
    ctx.trace.push({ node: `field:${label}:same_value`, ms: 0, choice: a.id });
    return a;
  }
  return undefined;
}

export function usableCandidates(
  deps: DecisionsExtractDeps,
  leaf: Leaf,
  candidates: OutlineNode[],
): Set<string> {
  const seen = new Set<string>();
  const keep = new Set<string>();
  for (const node of candidates) {
    if (/columnheader/i.test(node.role)) continue;
    const value = valueOf(deps, leaf, node);
    if (value === undefined) continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(node.id);
  }
  return keep;
}

async function judgeLeaf(
  ctx: AskContext,
  deps: DecisionsExtractDeps,
  leaf: Leaf,
): Promise<JsonValue | undefined> {
  const state = { instruction: ctx.instruction, page: pageDigest(deps.snap.nodes, 80) };
  if (leaf.kind === "boolean") {
    const response = await ask(ctx, `field:${leaf.path.join(".")}`, state, {
      value: {
        type: "noul",
        instructions: `Is this true of the page: ${leaf.description || leaf.path.join(" ")}?`,
      },
    });
    const score = round(noulAnswer(response, "value").noul);
    annotate(ctx.trace, { noul: score });
    return score >= 0.5;
  }
  const options = leaf.options ?? [];
  const response = await ask(ctx, `field:${leaf.path.join(".")}`, state, {
    value: {
      type: "choice",
      instructions: `Which value does the page show for: ${leaf.description || leaf.path.join(" ")}?`,
      criteria: {
        ...Object.fromEntries(options.map((option, index) => [`option_${index}`, option])),
        [NONE]: "The page does not say",
      },
    },
  });
  const answer = choiceAnswer(response, "value");
  annotate(ctx.trace, { choice: answer.choice, confidence: answer.confidence });
  if (answer.choice === NONE || answer.confidence < ctx.threshold) return undefined;
  return options[Number(answer.choice.slice("option_".length))];
}
