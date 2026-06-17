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

**Current Date:** $current_date

You are an expert evaluator of web-navigation agent trajectories. The rubric has already been scored per criterion (results below). Your job is to produce the overall outcome verdict.

Use the current date above to assess time-sensitive constraints in the task (e.g., a task referencing dates in the past relative to the current date is impossible — classify as task_validity.is_invalid with code 8.1).

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

Apply these rules when making the outcome verdict:

1. **Judge the delivered result, not the route.** If the final answer satisfies the user's requested deliverable and the trajectory does not contradict it, mark success even if the agent used an inefficient path, clicked around after finding the answer, or used a slightly different but reasonable search control. Do not fail solely because the process was imperfect.

2. **Use the simulated trajectory as truth.** Do not use outside/current-world knowledge to override what the saved browser state shows. If search results, page text, URLs, or screenshots in the trajectory support a concrete answer, judge against that evidence even if the real web may differ. Do not introduce an alternate "correct" answer from your own knowledge unless that alternate answer is visible in the supplied trajectory evidence.

3. **Treat attached screenshots as partial evidence.** Screenshots may be sampled from a longer trajectory. If the final answer is concrete and the action history shows the agent reached a relevant source (page, list, chart, search result, product page, map result), assume the answer may have been extracted from that source unless the attached screenshots or action history directly contradict it. Do not call a concrete answer fabricated merely because the exact supporting text is absent from the sampled screenshots.

4. **Require the actual deliverable.** The final answer is the user-visible deliverable. For tasks asking to find, show, get, browse, list, summarize, report, compare, or provide values/content, the final answer must contain the requested content or a direct correct link to the requested document/page. Merely saying the agent "found", "extracted", "provided", "displayed", "retrieved", or "located" the information is not enough, even if the browser reached the right page. The selected trajectory evidence is only context; it cannot fill in missing values, lists, links, or summaries that are absent from the final answer. Only purely navigational tasks phrased as opening a page can succeed from navigation alone.

5. **Report/document tasks need the report/document.** If the task asks to get, open, retrieve, download, or provide a report/document/page, the final answer must include a direct correct URL, the opened document/page itself must be the final browser state, or the final answer must include the requested document content. Merely naming the document title is not enough unless the user only asked for the title/name.

6. **Do not invent equivalence.** If the final answer gives a URL, document, article id, product, entity, date, or value that differs from what the trajectory visibly reached, do not assume an unseen redirect, canonicalization, or equivalence. Treat the mismatch as a contradiction unless the supplied trajectory evidence itself shows they are equivalent.

7. **Hard constraints still matter.** If the latest relevant attached screenshot, selected trajectory evidence, or action-history URL clearly shows that an explicit constraint was not met (for example wrong sort/filter/date/class, permanently closed location reported as active, visible product/list item outside the requested color/size/status, wrong URL/article id, or wrong entity), that is a critical issue.

8. **Dynamic sources can disagree.** Search results, charts, rankings, prices, and listings can differ across pages or update times in the saved trajectory. If the final answer is concrete and matches at least one relevant trajectory source, do not fail solely because another relevant source in the trajectory shows a different dynamic value, unless the final answer clearly used the contradicted source or the task required that exact source.

9. **Shopping/search constraints may be source-level.** For product-search tasks, a search query, filter, result page, or product title/snippet can satisfy a descriptive constraint such as "hypoallergenic" when the final answer provides concrete candidate products and no supplied evidence directly contradicts the constraint. Do not fail solely because a later product page does not repeat every search constraint as a formal specification.

10. **Separate nitpicks from critical issues.** Minor wording, harmless method choices, unsupported extra details that are not part of the requested deliverable, caveats about imperfect verification, or small presentation differences should not flip a successful answer to failure when the final answer still provides concrete requested content and the trajectory does not directly contradict it. Wrong requested entities, unsupported fabricated requested facts, active-vs-closed mistakes, wrong sort/filter results, wrong dates/classes, and missing requested content are critical.

Use this decision order:

- First ask whether the final answer contains the requested user-facing artifact: values, list items, summary, comparison, report link, product candidates, or page/document URL. If it only narrates that the artifact was found/extracted/provided, mark failure.
- Then check for direct contradictions in the supplied trajectory evidence. Contradictions must come from the provided action history, URLs, screenshots, or final answer, not from outside knowledge.
- If the final answer is concrete, the trajectory reached a relevant source, and the supplied evidence does not directly contradict the final answer, mark success.

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
