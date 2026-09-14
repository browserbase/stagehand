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
  /**
   * Verifier-backed runs the verifier failed to grade (`verifierError` set) —
   * their `_success` is the agent's self-report, so they must never hide
   * inside a gated batch.
   */
  ungradedRuns: number;
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
    const graded = typeof output.criterionCount === "number";
    const ungraded = !graded && output.verifierError !== undefined;
    if (!graded && !ungraded) continue;
    const toolSurface =
      typeof input.params?.toolSurface === "string" ? input.params.toolSurface : undefined;
    const key = [harness, toolSurface, input.modelName].filter(Boolean).join(" × ");
    const arm = arms.get(key) ?? {
      arm: key,
      gradedRuns: 0,
      ungradedRuns: 0,
      unverifiableCriteria: 0,
      totalCriteria: 0,
    };
    if (graded) {
      arm.gradedRuns += 1;
      arm.totalCriteria += output.criterionCount as number;
      arm.unverifiableCriteria += Array.isArray(output.evidenceInsufficient)
        ? output.evidenceInsufficient.length
        : 0;
    } else {
      arm.ungradedRuns += 1;
    }
    arms.set(key, arm);
  }
  return [...arms.values()];
}

/**
 * Per-arm ceiling on unverifiable criteria. Unset or invalid = report only.
 * Strict integer parsing: a malformed value ("1.5", "10foo") must not be
 * coerced into an unintended gate.
 */
export function resolveUnverifiableCriteriaLimit(): number | undefined {
  const raw = process.env[GATE_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/** Arms whose unverifiable-criteria count exceeds the limit. */
export function armsOverLimit(arms: ArmVerifiability[], limit: number): ArmVerifiability[] {
  return arms.filter((arm) => arm.unverifiableCriteria > limit);
}

/** Arms carrying self-reported (verifier-failed) rows. */
export function armsWithUngradedRuns(arms: ArmVerifiability[]): ArmVerifiability[] {
  return arms.filter((arm) => arm.ungradedRuns > 0);
}
