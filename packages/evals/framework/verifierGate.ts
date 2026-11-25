import type { EvalInput } from "../types/evals.js";

export interface ArmVerifiability {
  arm: string;
  gradedRuns: number;
  ungradedRuns: number;
  unverifiableCriteria: number;
  totalCriteria: number;
  passesWithoutBrowserUse: number;
}

const GATE_ENV = "EVAL_MAX_UNVERIFIABLE_CRITERIA";

function readFacadeToolCalls(output: Record<string, unknown>): number | undefined {
  const metrics = output.metrics;
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const metric = (metrics as Record<string, unknown>).facade_tool_calls;
  if (typeof metric !== "object" || metric === null) return undefined;
  const value = (metric as { value?: unknown }).value;
  return typeof value === "number" ? value : undefined;
}

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
      passesWithoutBrowserUse: 0,
    };
    if (graded) {
      arm.gradedRuns += 1;
      arm.totalCriteria += output.criterionCount as number;
      arm.unverifiableCriteria += Array.isArray(output.evidenceInsufficient)
        ? output.evidenceInsufficient.length
        : 0;
      if (output._success === true && readFacadeToolCalls(output) === 0) {
        arm.passesWithoutBrowserUse += 1;
      }
    } else {
      arm.ungradedRuns += 1;
    }
    arms.set(key, arm);
  }
  return [...arms.values()];
}

export function resolveUnverifiableCriteriaLimit(): number | undefined {
  const raw = process.env[GATE_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

export function armsOverLimit(arms: ArmVerifiability[], limit: number): ArmVerifiability[] {
  return arms.filter((arm) => arm.unverifiableCriteria > limit);
}

export function armsWithUngradedRuns(arms: ArmVerifiability[]): ArmVerifiability[] {
  return arms.filter((arm) => arm.ungradedRuns > 0);
}

export function armsWithPassesWithoutBrowserUse(arms: ArmVerifiability[]): ArmVerifiability[] {
  return arms.filter((arm) => arm.passesWithoutBrowserUse > 0);
}
