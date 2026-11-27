import type { DecisionModelConfig, JsonValue } from "../client.js";
import { extractionCompleted } from "../extractCheck.js";
import type { AskContext, TraceEntry } from "../pick.js";
import { EXTRACT_CONFIDENCE, readLeaf } from "./leaves.js";
import { readList } from "./lists.js";
import { type Leaf, MAX_FIELDS, type Plan, planSchema, Unsupported } from "./plan.js";
import type { DecisionsExtractDeps, DecisionsExtractOutcome } from "./types.js";
import { compactForJudge, setPath } from "./values.js";

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
    threshold: EXTRACT_CONFIDENCE,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
  };
  const forField = (leaf: Leaf, note = ""): AskContext => ({
    ...base,
    instruction: `${deps.instruction}\nField to find: ${leaf.path.join(".")}${leaf.description ? ` (${leaf.description})` : ""}${note}`,
  });

  const data: Record<string, JsonValue> = {};
  const missing: string[] = [];

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
