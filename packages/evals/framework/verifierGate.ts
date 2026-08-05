/**
 * Per-arm verifiability accounting for bench batches (STG-2752).
 *
 * Each graded run reports `criterionCount` and `evidenceInsufficient` (the
 * rubric criteria the verifier could not ground in evidence). This module
 * aggregates those per arm — one (harness × tool surface × model) cell of
 * the bench matrix — so unverifiable-criteria counts are reported per arm
 * and, when EVAL_MAX_UNVERIFIABLE_CRITERIA is set, gate the batch.
 */
import type { EvalInput } from "../types/evals.js";

export interface ArmVerifiability {
  arm: string;
  /** Runs the verifier graded (criterionCount present). */
  gradedRuns: number;
  unverifiableCriteria: number;
  totalCriteria: number;
}

const GATE_ENV = "EVAL_MAX_UNVERIFIABLE_CRITERIA";

export function summarizeArmVerifiability(
  results: Array<{ input: EvalInput; output: Record<string, unknown> }>,
  harness: string,
): ArmVerifiability[] {
  const arms = new Map<string, ArmVerifiability>();
  for (const { input, output } of results) {
    if (typeof output.criterionCount !== "number") continue;
    const toolSurface =
      typeof input.params?.toolSurface === "string" ? input.params.toolSurface : undefined;
    const key = [harness, toolSurface, input.modelName].filter(Boolean).join(" × ");
    const arm = arms.get(key) ?? {
      arm: key,
      gradedRuns: 0,
      unverifiableCriteria: 0,
      totalCriteria: 0,
    };
    arm.gradedRuns += 1;
    arm.totalCriteria += output.criterionCount;
    arm.unverifiableCriteria += Array.isArray(output.evidenceInsufficient)
      ? output.evidenceInsufficient.length
      : 0;
    arms.set(key, arm);
  }
  return [...arms.values()];
}

/** Per-arm ceiling on unverifiable criteria. Unset or invalid = report only. */
export function resolveUnverifiableCriteriaLimit(): number | undefined {
  const parsed = Number.parseInt(process.env[GATE_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Arms whose unverifiable-criteria count exceeds the limit. */
export function armsOverLimit(arms: ArmVerifiability[], limit: number): ArmVerifiability[] {
  return arms.filter((arm) => arm.unverifiableCriteria > limit);
}
