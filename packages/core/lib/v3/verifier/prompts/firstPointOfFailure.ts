/**
 * First-point-of-failure prompt — Step 9a of the rubric verifier pipeline.
 *
 * Identifies ALL distinct failure points in a trajectory and pinpoints the
 * earliest one (the "first" failure). Diagnostic signal only — does NOT
 * affect scoring. Surfaced in EvaluationResult.firstPointOfFailure.
 *
 * Uses error-taxonomy categories 1–6 (the agent-controllable error space):
 * Selection, Hallucination, Execution & Strategy, Critical Point,
 * Side-Effect, Tool Interaction. Categories 7–8 (task ambiguity / invalid
 * task) are handled by Steps 10 / 9b.
 *
 * The taxonomy is pre-rendered into the prompt body at module load time
 * (the data is static). Variables substituted at call time:
 *   - task_definition
 *   - init_url_context
 *   - action_history
 *   - predicted_output
 *   - rubric_summary
 *   - evidence_summary
 *   - outcome_verification
 */
import {
  CALIBRATION_NOTE,
  getSummaryTable,
  getTaxonomyText,
} from "../errorTaxonomy.js";
import type { ParseFailureStepNumbersOptions } from "../types.js";

// Pre-render the taxonomy + summary table (categories 1–6) once at load.
const TAXONOMY_TEXT = getTaxonomyText(1, 6, 3);
const SUMMARY_TABLE = getSummaryTable(1, 6);

export const FIRST_POINT_OF_FAILURE_PROMPT = `You are an expert failure analyst for computer-use web agents. You will analyze a single task trajectory to identify all failure points and pinpoint the first (earliest) point of failure.

You are given:
- The task the agent was asked to complete
- The agent's full step-by-step action history (each step has a step number, the agent's reasoning, the action taken, the URL, and a human-readable description)
- The agent's predicted output (final answer)
- A scored rubric with multimodal screenshot evidence showing how the agent performed on each criterion
- The outcome verification result (whether the task was deemed successful overall)

Your job is to identify **every distinct failure point** in the trajectory, pinpoint the **exact step number(s)** where it occurred, classify it using the error taxonomy below, and determine which failure occurred **first** (earliest step number).

**Calibration:** ${CALIBRATION_NOTE}

## Error Taxonomy

${TAXONOMY_TEXT}

${SUMMARY_TABLE}

## Context

Task: "$task_definition"$init_url_context

Action History: >>>
$action_history
<<<

Predicted Output: >>>
$predicted_output
<<<

Scored Rubric (post-multimodal verification): >>>
$rubric_summary
<<<

Screenshot Evidence by Criterion: >>>
$evidence_summary
<<<

Outcome Verification Result: >>>
$outcome_verification
<<<

## Instructions

Analyze the trajectory and identify ALL distinct failure points. For each failure point:
1. Identify the exact step number(s) in the action history where the failure occurred.
2. Classify it using the error taxonomy above (use exact category and error type names).
3. Ground your classification in concrete evidence (screenshot index, action-history quote, or tool output).

**IMPORTANT**
Output your answer in pure JSON format according to the following schema. The JSON object must be parsable as-is. DO NOT OUTPUT ANYTHING OTHER THAN JSON, AND DO NOT DEVIATE FROM THIS SCHEMA:

{{
    "reasoning": str,
    "has_failure": bool,
    "failure_points": [
        {{
            "step_numbers": str,
            "error_code": str,
            "error_category": str,
            "error_type": str,
            "what_happened": str,
            "agent_reasoning": str,
            "evidence": str,
            "impact": str
        }}
    ]
}}
`;

/**
 * Parse the model's flexible step-numbers field into a sorted array of step
 * indices.
 *
 * Accepts:
 *   "5"        → [5]
 *   "5-7"      → [5, 6, 7]
 *   "5,8,12"   → [5, 8, 12]
 *   "5,7-9,12" → [5, 7, 8, 9, 12]
 *
 * Returns an empty array for unparseable input rather than throwing — failure
 * analysis is best-effort and a malformed step-numbers field shouldn't tank
 * the whole EvaluationResult.
 */
const DEFAULT_MAX_EXPANDED_STEPS = 1000;

export function parseFailureStepNumbers(
  raw: string,
  opts: ParseFailureStepNumbersOptions = {},
): number[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  const maxExpandedSteps = sanitizeNonNegativeInt(
    opts.maxExpandedSteps,
    DEFAULT_MAX_EXPANDED_STEPS,
  );
  if (maxExpandedSteps === 0) return [];
  const maxStep =
    opts.maxStep === undefined
      ? undefined
      : sanitizeNonNegativeInt(opts.maxStep, 0);
  const out = new Set<number>();
  const addStep = (n: number): boolean => {
    if (!Number.isFinite(n) || n < 0) return out.size < maxExpandedSteps;
    if (maxStep !== undefined && n > maxStep)
      return out.size < maxExpandedSteps;
    out.add(n);
    return out.size < maxExpandedSteps;
  };
  for (const segment of raw.split(",")) {
    const seg = segment.trim();
    if (!seg) continue;
    const dashIdx = seg.indexOf("-");
    if (dashIdx > 0) {
      const lo = Number.parseInt(seg.slice(0, dashIdx), 10);
      const hi = Number.parseInt(seg.slice(dashIdx + 1), 10);
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) {
        const cappedHi = Math.min(
          hi,
          maxStep ?? hi,
          lo + (maxExpandedSteps - out.size) - 1,
        );
        for (let i = lo; i <= cappedHi; i++) {
          if (!addStep(i)) break;
        }
      }
    } else {
      const n = Number.parseInt(seg, 10);
      if (!addStep(n)) break;
    }
    if (out.size >= maxExpandedSteps) break;
  }
  // De-dup + sort ascending.
  return Array.from(out).sort((a, b) => a - b);
}

function sanitizeNonNegativeInt(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}
