/**
 * Per-criterion scoring prompt — Approach A's replacement for Steps 4 + 6.
 *
 * One call grades ONE criterion against its top-K evidence (images + text),
 * returning both an analysis and an earned-points score. With N criteria
 * this is N calls (parallelizable). Drops the Step-6 whole-rubric rescore
 * entirely since `processScore` becomes Σ earned_points / Σ max_points.
 *
 * Variables:
 *   - task_definition          — instruction string
 *   - init_url_context         — "Starting URL: ..." or empty
 *   - action_history           — compact textual action history
 *   - agent_predicted_output   — agent's final answer / message
 *   - criterion_idx            — index in the rubric
 *   - criterion_name           — the criterion text
 *   - criterion_description    — description of what's being measured
 *   - criterion_max_points     — max points for this criterion
 *   - criterion_condition      — optional "Condition: ..." line, or empty
 *   - evidence_manifest        — labelled list of the top-K evidence points
 *                                attached below (image refs + ariaTree
 *                                snippets in chronological order).
 */
export const MM_PER_CRITERION_SCORE_PROMPT = `Task: $task_definition$init_url_context

You are scoring ONE rubric criterion against the relevant evidence from an agent's trajectory.

**Action History:**
$action_history

**Agent's Predicted Output (Final Answer):**
$agent_predicted_output

**Criterion #$criterion_idx — "$criterion_name"**
- Description: $criterion_description
- Max points: $criterion_max_points
$criterion_condition

**Evidence (top-K most relevant):**
$evidence_manifest

Each evidence reference points to an image attached below or to a text snippet shown inline above. Screenshots are listed in chronological order; when two screenshots show the same element, **the LATER screenshot reflects the final state and takes precedence**.

**Core Evaluation Principles:**

1. **Best Effort.** Reward effort within constraints the agent cannot control.
2. **Uncontrollable blockers** (CAPTCHA, login walls, sold out, site down, entity nonexistence) → award full credit when screenshots confirm the blocker.
3. **Controllable failures** (wrong selections when correct options exist, hallucinations, premature giveup) → penalize per severity.
4. **Hard constraints in the task** (specific qualifications, attributes, filters) → only award full credit when the constraint is actually met in the final evidence, not just searched for.
5. **Conditional criteria.** If this criterion has a Condition and the condition is NOT met, set \`earned_points\` to \`criterion_max_points\` (criterion is not applicable) and note this in the justification.
6. **Nitpick vs critical error scoring:**
   - Only nitpicks → 75–100% of max
   - Correct approach, wrong final answer → 40–80%
   - Critical error → penalize per severity

**Output Format:**

Output one JSON object:

{{
  "criterion_idx": $criterion_idx,
  "applicable_evidence": "Which evidence supports the score; cite by 'Screenshot N — step=K' or aria-tree step number. If no evidence is applicable, state that.",
  "justification": "How the evidence supports the score. If using condition-not-met rule, explain.",
  "earned_points": <number in [0, $criterion_max_points]>,
  "evidence_sufficient": true,
  "condition_met": null
}}

- \`earned_points\` must be in [0, $criterion_max_points].
- \`evidence_sufficient\` = false when the available evidence is genuinely too sparse to grade fairly. The verifier will mark the criterion as evidence-insufficient.
- \`condition_met\` is a boolean when the criterion has a Condition; otherwise null.

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
