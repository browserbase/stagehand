import { z } from "zod";

const CheckSchema = z.object({
  requirement: z
    .string()
    .describe(
      "Quote the relevant task/rubric requirement with all qualifiers intact, or explain why none applies",
    ),
  evidence: z
    .string()
    .describe(
      "Observed facts and step IDs, or the missing evidence; inspect the final answer for deliverables. If a rubric fallback clause covers this requirement (item not offered / out of stock / no exact match, disclosed in the final answer), state which clause applies and mark the requirement supported under the fallback rather than contradicted.",
    ),
  state: z.enum(["supported", "contradicted", "unresolved", "not_applicable"]),
});

const AchievabilitySchema = z.object({
  requirement: z.string().describe("The requested goal whose achievability is assessed"),
  evidence: z
    .string()
    .describe(
      "Recorded observations showing either that the goal was not achievable on the site (item not sold, out of stock, online purchase not offered, no qualifying results) or that an environment blocker (bot wall, CAPTCHA, login wall, crash, site error, frozen widget) stopped it, and whether the final answer disclosed it",
    ),
  state: z.enum([
    "achievable",
    "unachievable_established",
    /** Requested item unavailable/no exact match, agent disclosed it and took the alternative the RUBRIC's fallback clause allows. */
    "unachievable_fallback_accepted",
    "environment_blocked",
    "unresolved",
  ]),
});

export const OutcomeChecksSchema = z.object({
  critical_point: CheckSchema,
  identity_and_constraints: CheckSchema,
  deliverable_completeness: CheckSchema,
  /**
   * Optional: when the recorded site state shows the requested goal could not be achieved by any
   * agent (not an environment blocker), so downstream can exclude the row from capability scores.
   */
  goal_achievability: AchievabilitySchema.optional(),
});

const REQUIRED_CHECKS = [
  "critical_point",
  "identity_and_constraints",
  "deliverable_completeness",
] as const;

export type OutcomeChecks = z.infer<typeof OutcomeChecksSchema>;

export function unresolvedChecks(): OutcomeChecks {
  const check = {
    requirement: "Not evaluated",
    evidence: "Judge did not return a result",
    state: "unresolved" as const,
  };
  return {
    critical_point: { ...check },
    identity_and_constraints: { ...check },
    deliverable_completeness: { ...check },
  };
}

/** Aggregate process credit or a confident boolean cannot override a failed requirement. */
export function checkedOutcomeState(
  outcome:
    | {
        state?: "supported" | "contradicted" | "unresolved";
        output_success: boolean;
        checks?: OutcomeChecks;
        requirements?: Array<{ state: string }>;
      }
    | undefined,
): "supported" | "contradicted" | "unresolved" {
  const checks = outcome?.checks && REQUIRED_CHECKS.map((k) => outcome.checks![k]).filter(Boolean);
  if (
    outcome?.state === "contradicted" ||
    checks?.some((c) => c.state === "contradicted") ||
    outcome?.requirements?.some((r) => r.state === "contradicted")
  )
    return "contradicted";
  // Experiment (VERIFIER_UNRESOLVED_BLOCKS=0): trust the judge's pass unless something is CONTRADICTED;
  // unresolved checks and unachievable/blocked achievability states no longer veto it.
  if (process.env.VERIFIER_UNRESOLVED_BLOCKS === "0") {
    return outcome?.output_success ? "supported" : "unresolved";
  }
  // Consistency: if the judge itself established that the goal was not achieved (unachievable or
  // environment-blocked, without a rubric-sanctioned fallback), the outcome cannot be supported.
  const achiev = outcome?.checks?.goal_achievability?.state;
  if (achiev === "unachievable_established" || achiev === "environment_blocked")
    return "unresolved";
  if (
    !checks ||
    checks.length !== REQUIRED_CHECKS.length ||
    checks.some((c) => c.state === "unresolved") ||
    outcome?.state !== "supported" ||
    !outcome.output_success
  )
    return "unresolved";
  return "supported";
}

/** True when the judge established from observations that the goal was not achievable on the site. */
export function goalUnachievable(checks: OutcomeChecks | undefined): boolean {
  return checks?.goal_achievability?.state === "unachievable_established";
}

/** True when the judge observed an environment blocker (bot wall, CAPTCHA, login wall, site error) stopping the goal. */
export function environmentBlocked(checks: OutcomeChecks | undefined): boolean {
  return checks?.goal_achievability?.state === "environment_blocked";
}

/** True when the judge applied a rubric-sanctioned disclosed fallback (outcome may be supported; categorize the row). */
export function disclosedFallback(checks: OutcomeChecks | undefined): boolean {
  return checks?.goal_achievability?.state === "unachievable_fallback_accepted";
}
