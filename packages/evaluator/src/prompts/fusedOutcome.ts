/**
 * Fused outcome prompt — Approach A's combined Step 8 + optional folded
 * 9a/10 call. Consumes a pre-scored rubric (computed deterministically from
 * Approach A's per-criterion analyses) and emits the outcome verdict,
 * findings, and optionally the first point of failure + task validity.
 *
 * Variables:
 *   - task_definition          — instruction string
 *   - init_url_context         — "Starting URL: ..." or empty
 *   - action_history           — compact textual action history
 *   - outcome_evidence_summary — selected text evidence snippets from the
 *                                trajectory, ordered by step
 *   - agent_predicted_output   — agent's final answer / message
 *   - rubric_summary           — pre-scored rubric: per-criterion earned/max
 *                                + the justifications from per-criterion calls
 *   - taxonomy_block           — error taxonomy text (only when
 *                                fold_failure_analysis is true; "" otherwise)
 *   - fold_failure_analysis    — "true" / "false"
 *   - fold_task_validity       — "true" / "false"
 *   - final_state_block        — always-attached final URL + ariaTree of the
 *                                last step probe and finalObservation; this
 *                                bypasses the keyword-based excerpt selection
 *                                used by outcome_evidence_summary so the
 *                                judge always has the closing page content.
 */
export const FUSED_OUTCOME_PROMPT = `Task: $task_definition$init_url_context

**Date of recorded run:** $current_date

You are an expert evaluator of web-navigation agent trajectories. The rubric has already been scored per criterion (results below). Your job is to produce the overall outcome verdict.

Use the recorded date for time-sensitive constraints. If unknown, do not infer the run date or reject the task because time has elapsed since recording.

**Action History:**
$action_history

**Selected Trajectory Evidence:**
$outcome_evidence_summary

**Final trajectory state** (authoritative — page content and screenshot captured at the very end of the run; treat as ground truth for what the agent saw on its final page, even when no \`extract\`/\`observe\` step appears in the action history):
$final_state_block

**Agent's Predicted Output (Final Answer):**
$agent_predicted_output

**Pre-Scored Rubric (per-criterion earned points + justifications):**
$rubric_summary

**Optional sections in the response:**
- Failure analysis: $fold_failure_analysis
- Task validity classification: $fold_task_validity

When failure analysis is requested and you judge \`output_success: false\`, populate \`failure_point\` using the error taxonomy below:

$taxonomy_block

When task validity is requested, populate \`task_validity\` with the booleans \`is_ambiguous\` / \`is_invalid\` and, when each is true, a single one-line free-form reason in \`ambiguity_reason\` / \`invalid_reason\` (e.g., "Requested dates are in the past relative to the current date"). Leave the reason field empty when the corresponding flag is false.

---

**Outcome judgment:**
\`output_success\` is your independent binary verdict on whether the agent completed the task. It is informed by the per-criterion scores but is not a function of them — a task can have high process score and still fail (right approach, wrong final answer), or have lower process score and still succeed.

Apply the system grading contract to each required outcome check. A supported outcome
requires supplied references or recorded observations establishing the requested result.
A relevant page visit, plausible final answer, or absence of a contradiction cannot resolve
missing evidence. Keep process credit independent of outcome.

Inspect the actual final answer for requested content and format; research visible only in
the trajectory does not supply an omitted deliverable. For browser-state tasks, completion
can instead be established by the recorded state. A later unrelated page or capture failure
does not negate an earlier proven result, but later actions that undo the required state do.

For dynamic prices, rankings and availability, compare the relevant entity, variant, source
and recorded time. Enforce an exact source when the task requires it. Do not substitute a
value from a different entity or variant, or invent an unseen redirect or functional equivalence.

**Findings:** Surface actionable patterns: failed tool usage, agent-strategy issues, rubric quality problems, capture gaps. Each finding gets a category, severity, description, and (optional) related steps + suggested action. Keep findings sparse and load-bearing.

---

**Output Format:**

Output one JSON object:

{
  "outcome": {
    "checks": {
      "critical_point": {"requirement": "...", "evidence": "...", "state": "supported|contradicted|unresolved|not_applicable"},
      "identity_and_constraints": {"requirement": "...", "evidence": "...", "state": "supported|contradicted|unresolved|not_applicable"},
      "deliverable_completeness": {"requirement": "...", "evidence": "...", "state": "supported|contradicted|unresolved|not_applicable"},
      "goal_achievability": {"requirement": "...", "evidence": "...", "state": "achievable|unachievable_established|unachievable_fallback_accepted|environment_blocked|unresolved"}
    },
    "primary_intent": "<one-sentence restatement of what the task was asking for>",
    "reasoning": "<your reasoning for the success / failure verdict>",
    "output_success": true,
  "state": "supported|contradicted|unresolved",
    "findings": [
      {
        "category": "agent_tool_usage|agent_strategy|rubric_quality|trajectory_capture|task_specification|verifier_uncertainty|other",
        "severity": "info|warning|blocking",
        "description": "...",
        "suggestedAction": "...",
        "relatedSteps": [3, 4]
      }
    ]
  },
  "failure_point": {
    "step_index": 17,
    "error_code": "1.4",
    "error_category": "Selection",
    "description": "<one-line description of what went wrong at this step>"
  },
  "task_validity": {
    "is_ambiguous": false,
    "ambiguity_reason": "",
    "is_invalid": false,
    "invalid_reason": ""
  }
}

- Omit \`failure_point\` when \`output_success\` is true or failure analysis was not requested.
- Omit \`task_validity\` when task-validity classification was not requested.

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
