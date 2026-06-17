/**
 * Fused judgment prompt — Approach B's single-call replacement for
 * Steps 4+6+8 (and optionally folded 9a + 10).
 *
 * One multimodal call grades every rubric criterion, emits an independent
 * outcome verdict, surfaces findings, optionally identifies the first point
 * of failure, and optionally classifies task validity. The structured
 * response is rich enough to populate the full `EvaluationResult` object without
 * additional LLM calls.
 *
 * Variables:
 *   - task_definition          — instruction string
 *   - init_url_context         — "Starting URL: ..." or empty
 *   - action_history           — compact textual action history
 *   - agent_predicted_output   — agent's final answer / message
 *   - rubric_block             — full rubric: index, criterion, description,
 *                                max_points, optional condition
 *   - evidence_block           — per-criterion top-K evidence manifest
 *                                (image refs + ariaTree snippets). Each image
 *                                in the message body is keyed by its label
 *                                here (e.g., "Evidence #3 — step=12, probe").
 *   - taxonomy_block           — error taxonomy text (only when
 *                                fold_failure_analysis = true). Otherwise
 *                                empty string.
 *   - fold_failure_analysis    — "true" / "false" — whether to emit failure
 *                                analysis in the response.
 *   - fold_task_validity       — "true" / "false" — whether to emit task
 *                                validity classification in the response.
 *   - final_state_block        — always-attached final URL + ariaTree of the
 *                                last step probe and finalObservation; this
 *                                bypasses the per-criterion top-K selection
 *                                so the judge always has the closing page
 *                                content available.
 */

export const FUSED_JUDGMENT_PROMPT = `Task: $task_definition$init_url_context

**Current Date:** $current_date

You are an expert evaluator of web-navigation agent trajectories. You will grade the agent's run against a rubric, decide whether the overall task succeeded, and surface diagnostics — all in one structured response.

Use the current date above to assess time-sensitive constraints in the task (e.g., a task referencing dates in the past relative to the current date is impossible — classify as task_validity.is_invalid with code 8.1).

**Action History:**
$action_history

**Agent's Predicted Output (Final Answer):**
$agent_predicted_output

**Rubric:**
$rubric_block

**Evidence (grouped by criterion):**
$evidence_block

Each evidence reference points to an image attached below or to a text snippet inline above. Screenshots are listed in chronological order across the trajectory; when two screenshots show the same element, **the LATER screenshot reflects the final state and takes precedence**.

**Final trajectory state** (authoritative — this is the page content and screenshot captured at the very end of the run; treat it as ground truth for what the agent saw on its final page, even if no \`extract\`/\`observe\` step appears in the action history):
$final_state_block

**Optional sections to include in the response:**
- Failure analysis: $fold_failure_analysis
- Task validity classification: $fold_task_validity

When failure analysis is requested and you judge \`output_success: false\`, you must populate \`failure_point\` using the error taxonomy below:

$taxonomy_block

When task validity is requested, you must populate \`task_validity\` with the booleans \`is_ambiguous\` / \`is_invalid\` and, when each is true, a single one-line free-form reason in \`ambiguity_reason\` / \`invalid_reason\` (e.g., "Requested dates are in the past relative to the current date"). Leave the reason field empty when the corresponding flag is false.

---

**Core Evaluation Principles** (these OVERRIDE the criterion descriptions when they conflict):

1. **Best Effort Evaluation.** The agent should be evaluated on helpfulness and effort within constraints it cannot control.

2. **Uncontrollable Blockers** (award full credit when these prevent task completion): platform issues (site down, CAPTCHA, login walls), entity non-existence, availability constraints (out of stock, sold out), platform limitations. If screenshots CONFIRM the blocker, award full credit even for downstream dependent criteria.

3. **Controllable Failures** (penalize): wrong selections when correct options are available, poor execution (not using filters, not attempting specified platforms), hallucinations (claiming success without evidence), insufficient effort.

4. **Tasks with Explicit Constraints.** Distinguish "searched for the constraint" from "found results that actually satisfy it". If the hard constraint is NOT met in the evidence, award only minimal partial credit for the search effort.

5. **Ambiguous Wording — Don't Penalize for One Valid Interpretation.** If the task has multiple defensible readings, the agent picking one is fine.

6. **Cascading Dependencies:**
   - Scenario A: Blocker is uncontrollable → award full credit for downstream criteria that couldn't be attempted.
   - Scenario B: Blocker is a controllable error → cascade partial/zero credit downstream.
   - Scenario C: Don't re-penalize for the same deviation across multiple criteria.
   - Scenario D: Shared platform blockers across sibling sub-tasks → award full credit for all affected siblings.

7. **Conditional Criteria.** Some criteria have a "condition" field. Only score them when the condition is met; otherwise mark the criterion as not applicable (give it max_points so it doesn't drag down the process score).

8. **Distinguish nitpicks from critical errors:**
   - Only nitpicks → 75–100% of max
   - Correct approach, wrong final answer → 40–80%
   - Critical error → penalize per severity
   - Mix of nitpicks + a critical error → score based on the critical error

**Outcome Judgment:**

\`output_success\` is your independent binary verdict on whether the agent completed the task. It is informed by the per-criterion scores but is not a function of them — a task can have high process score and still fail (right approach, wrong final answer) or have lower process score and still succeed (the answer is right, intermediate steps were inelegant).

**Findings:** Surface actionable patterns: failed tool usage, agent-strategy issues, rubric quality problems, capture gaps. Each finding gets a category, severity, description, and (optional) related steps + suggested action. Keep findings sparse and load-bearing.

---

**Output Format:**

Output one JSON object matching this schema. Include the optional sections only when requested above.

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
  "per_criterion": [
    {{
      "criterion_idx": 0,
      "applicable_evidence": "Which evidence is applicable; cite by 'Screenshot N — step=K' or aria-tree step number.",
      "justification": "How the visual / textual evidence supports your score.",
      "earned_points": 4,
      "evidence_sufficient": true
    }}
  ],
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

- Omit \`failure_point\` when \`output_success\` is true or when failure analysis was not requested.
- Omit \`task_validity\` when task-validity classification was not requested.
- You MUST emit exactly one \`per_criterion\` entry per rubric item, in rubric order.
- \`earned_points\` must be in [0, max_points] for that criterion.

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
