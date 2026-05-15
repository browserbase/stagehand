/**
 * Screenshot-criterion relevance prompt — Step 2 of the rubric verifier
 * pipeline.
 *
 * The verifier feeds this prompt one screenshot at a time alongside the full
 * rubric criteria block; the model returns a 0–10 relevance score for EACH
 * criterion. The verifier later sorts screenshots by relevance per criterion
 * to produce the top-K groupings consumed by Step 4.
 *
 * Variables:
 *   - task_definition    — task instruction string
 *   - init_url_context   — optional "Starting URL: ..." appendix
 *   - rubric_criteria    — numbered list of criteria ("\n{idx}. **{name}**\n   Description: {desc}\n")
 *
 * Note: the prompt asks the model to emit `{"criterion_0": N, ...}`. The
 * orchestration layer (rubricVerifier) accepts either that flat shape or a
 * `{ scores: [{ criterion_idx, score }] }` form for robustness — see the
 * normalization helper in rubricVerifier.ts.
 */
export const MM_SCREENSHOT_CRITERION_RELEVANCE_PROMPT = `Task: $task_definition$init_url_context

You are analyzing a screenshot from an agent's trajectory to determine which rubric criteria this screenshot is most relevant to.

**Rubric Criteria:**
$rubric_criteria

**Your Task:**
For EACH criterion listed above, assign a relevance score from 0-10 indicating how much this screenshot helps evaluate that specific criterion.

**Scoring Guidelines:**
- **10**: Screenshot directly shows critical evidence for this criterion (e.g., shows the exact item being searched, cart contents, confirmation page)
- **7-9**: Screenshot shows important contextual information for this criterion (e.g., search results, filters applied, navigation state)
- **4-6**: Screenshot shows somewhat relevant information for this criterion (e.g., related page, partial information)
- **1-3**: Screenshot shows minimal relevance to this criterion (e.g., wrong page, unrelated content)
- **0**: Screenshot is completely irrelevant to this criterion

**Important:**
- A screenshot can be highly relevant to multiple criteria
- Focus on what is VISIBLE in the screenshot, not what the agent claimed to do
- Consider whether the screenshot confirms or contradicts criterion requirements

Please output a JSON object with scores for ALL criteria:

{{
  "criterion_0": <score_0_to_10>,
  "criterion_1": <score_0_to_10>,
  ...
  "criterion_N": <score_0_to_10>
}}

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
