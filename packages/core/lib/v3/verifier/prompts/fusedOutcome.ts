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
 *   - agent_predicted_output   — agent's final answer / message
 *   - rubric_summary           — pre-scored rubric: per-criterion earned/max
 *                                + the justifications from per-criterion calls
 *   - taxonomy_block           — error taxonomy text (only when
 *                                fold_failure_analysis is true; "" otherwise)
 *   - fold_failure_analysis    — "true" / "false"
 *   - fold_task_validity       — "true" / "false"
 */
export const FUSED_OUTCOME_PROMPT = `Task: $task_definition$init_url_context

**Current Date:** $current_date

You are an expert evaluator of web-navigation agent trajectories. The rubric has already been scored per criterion (results below). Your job is to produce the overall outcome verdict.

Use the current date above to assess time-sensitive constraints in the task (e.g., a task referencing dates in the past relative to the current date is impossible — classify as task_validity.is_invalid with code 8.1).

**Action History:**
$action_history

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

**Findings:** Surface actionable patterns: failed tool usage, agent-strategy issues, rubric quality problems, capture gaps. Each finding gets a category, severity, description, and (optional) related steps + suggested action. Keep findings sparse and load-bearing.

---

**Output Format:**

Output one JSON object:

{{
  "outcome": {{
    "primary_intent": "<one-sentence restatement of what the task was asking for>",
    "reasoning": "<your reasoning for the success / failure verdict>",
    "output_success": true,
    "findings": [
      {{
        "category": "agent_tool_usage|agent_strategy|rubric_quality|trajectory_capture|task_specification|verifier_uncertainty|other",
        "severity": "info|warning|blocking",
        "description": "...",
        "suggestedAction": "...",
        "relatedSteps": [3, 4]
      }}
    ]
  }},
  "failure_point": {{
    "step_index": 17,
    "error_code": "1.4",
    "error_category": "Selection",
    "description": "<one-line description of what went wrong at this step>"
  }},
  "task_validity": {{
    "is_ambiguous": false,
    "ambiguity_reason": "",
    "is_invalid": false,
    "invalid_reason": ""
  }}
}}

- Omit \`failure_point\` when \`output_success\` is true or failure analysis was not requested.
- Omit \`task_validity\` when task-validity classification was not requested.

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
