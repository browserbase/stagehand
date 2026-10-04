import type { DecisionModelConfig, JsonValue } from "../client.js";
import { extractionCompleted } from "../extractCheck.js";
import type { AskContext, TraceEntry } from "../pick.js";
import { EXTRACT_CONFIDENCE, readLeaf } from "./leaves.js";
import { readList } from "./lists.js";
import { type Leaf, MAX_FIELDS, type Plan, planSchema, Unsupported } from "./plan.js";
import type { DecisionsExtractDeps, DecisionsExtractOutcome } from "./types.js";
import { compactForJudge, setPath } from "./values.js";

/**
 * Experimental extract() on the decision model: pick-and-copy. The decision model cannot write text, but an
 * extraction rarely needs writing: the values are on the page. For every
 * field of the schema the decision model picks the element that holds the value and code
 * copies that element's text (or link URL), parsing numbers. Lists are
 * induced from one exemplar item: the decision model picks each field in the FIRST item, code
 * finds the repeating container and reads the same relative position in every
 * sibling. Booleans and enums, which are judgments rather than copies, are
 * asked directly. Anything the schema or the page does not fit goes to the LLM.
 */

export async function runDecisionsExtract(
  config: DecisionModelConfig & { actConfidence?: number },
  deps: DecisionsExtractDeps,
): Promise<DecisionsExtractOutcome> {
  const trace: TraceEntry[] = [];
  const finish = (outcome: DecisionsExtractOutcome): DecisionsExtractOutcome => {
    deps.logger.info("Decisions extract pipeline finished", {
      category: "decisions",
      instruction: deps.instruction,
      outcome: outcome.kind,
      reason: outcome.kind === "fallback" ? outcome.reason : "",
      trace: JSON.stringify(trace),
    });
    return outcome;
  };

  let plan: Plan;
  try {
    plan = planSchema(deps.schema);
  } catch (error) {
    if (error instanceof Unsupported)
      return finish({ kind: "fallback", reason: `schema:${error.message}` });
    throw error;
  }
  const fieldCount =
    plan.leaves.length + plan.lists.reduce((sum, list) => sum + list.fields.length, 0);
  if (fieldCount === 0 || fieldCount > MAX_FIELDS) {
    return finish({ kind: "fallback", reason: `schema:${fieldCount}_fields` });
  }

  const base = {
    config,
    trace,
    // Lower than act()'s 0.7: a wrong copy is caught by the schema, the list
    // structure and the completion gate, and nothing on the page is touched.
    threshold: EXTRACT_CONFIDENCE,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
  };
  // Each field is its own question; the field's name and description steer
  // both the lexical pruning and the decision model.
  const forField = (leaf: Leaf, note = ""): AskContext => ({
    ...base,
    instruction: `${deps.instruction}\nField to find: ${leaf.path.join(".")}${leaf.description ? ` (${leaf.description})` : ""}${note}`,
  });

  const data: Record<string, JsonValue> = {};
  const missing: string[] = [];

  // Scalars and list exemplars are independent: ask them all at once.
  const [scalars, lists] = await Promise.all([
    Promise.all(plan.leaves.map((leaf) => readLeaf(forField(leaf), deps, leaf))),
    Promise.all(plan.lists.map((list) => readList(list, deps, forField, trace))),
  ]);

  plan.leaves.forEach((leaf, index) => {
    const value = scalars[index];
    if (value === undefined) {
      if (leaf.required) missing.push(leaf.path.join("."));
      return;
    }
    setPath(data, leaf.path, value);
  });
  plan.lists.forEach((list, index) => {
    const items = lists[index];
    if (items === undefined) {
      if (list.required) missing.push(list.path.join("."));
      return;
    }
    setPath(data, list.path, items);
  });

  if (missing.length > 0)
    return finish({ kind: "fallback", reason: `unresolved:${missing.slice(0, 5).join(",")}` });

  let completed = true;
  if (deps.gate) {
    // A large list would overflow the judge; it sees the shape and the first
    // items instead of the pick path throwing away a finished extraction.
    const verdict = await extractionCompleted(
      { ...base, instruction: deps.instruction },
      compactForJudge(data),
    );
    completed = verdict.completed;
    if (!completed) return finish({ kind: "fallback", reason: `incomplete@${verdict.score}` });
  }
  return finish({ kind: "done", data, completed });
}

export type { DecisionsExtractDeps, DecisionsExtractOutcome } from "./types.js";
