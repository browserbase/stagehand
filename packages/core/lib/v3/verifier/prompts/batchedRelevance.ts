/**
 * Batched evidence-relevance prompt — replacement for the per-screenshot
 * MM_SCREENSHOT_CRITERION_RELEVANCE_PROMPT.
 *
 * One call grades the relevance of B evidence points (mixed image + text)
 * against all N rubric criteria. Reduces Step 2 cost from M calls to
 * ⌈M / B⌉ calls. Each evidence point in the batch is labelled with an
 * `evidence_idx` (0..B-1) the model must echo back so we can join the
 * scores to the right evidence.
 *
 * Variables:
 *   - task_definition    — task instruction string
 *   - init_url_context   — optional "Starting URL: ..." appendix
 *   - rubric_criteria    — numbered list of criteria ("\n{idx}. **{name}**\n   Description: {desc}\n")
 *   - evidence_manifest  — textual list describing each evidence point in the
 *                          batch: kind (image/text), source (probe/agent),
 *                          step index, brief preview. Lets the model line up
 *                          the inline images/text with the `evidence_idx`
 *                          it's expected to score.
 */
export const MM_BATCHED_RELEVANCE_PROMPT = `Task: $task_definition$init_url_context

You are analyzing a batch of evidence points (screenshots and text snippets) from an agent's trajectory to determine which rubric criteria each evidence point helps evaluate.

**Rubric Criteria:**
$rubric_criteria

**Evidence Points in This Batch:**
$evidence_manifest

The evidence is presented to you in order: each image / text block in this message corresponds to one entry in the manifest above, identified by its \`evidence_idx\`.

**Your Task:**
For EACH evidence point in the batch, assign a relevance score from 0–10 against EACH criterion.

**Scoring Guidelines:**
- **10**: Evidence directly shows critical proof for this criterion (e.g., shows the exact item, cart contents, confirmation page, the filled form field).
- **7-9**: Evidence shows important contextual information for this criterion (search results, applied filters, navigation state).
- **4-6**: Evidence shows partial / related information for this criterion.
- **1-3**: Evidence shows minimal relevance to this criterion.
- **0**: Evidence is completely irrelevant to this criterion.

**Important:**
- An evidence point can be highly relevant to multiple criteria.
- Focus on what is VISIBLE in the screenshot or PRESENT in the text snippet, not what the agent claimed.
- Text-form evidence (e.g., accessibility tree snippets, agent text, JSON tool outputs) is especially relevant for criteria asking "is this field filled with X?", "does the page contain Y?", or "did the tool return X?" — score it accordingly.

**Output Format:**
Output a JSON object with an \`items\` list. One entry per evidence point in the batch:

{{
  "items": [
    {{
      "evidence_idx": 0,
      "scores": [
        {{ "criterion_idx": 0, "score": 7 }},
        {{ "criterion_idx": 1, "score": 2 }}
      ]
    }},
    ...one entry per evidence point...
  ]
}}

You MUST include an entry for every \`evidence_idx\` listed in the manifest, and every criterion_idx in each \`scores\` list.

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
