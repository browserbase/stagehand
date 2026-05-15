/**
 * Batched evidence-analysis prompt — Step 4 of the MMRubricAgent pipeline
 * (batched variant).
 *
 * Verbatim port of `MM_SCREENSHOT_BATCHED_EVIDENCE_ANALYSIS_PROMPT` from
 * microsoft/fara/webeval/src/webeval/rubric_agent/prompts.py (line 836).
 *
 * One LLM call per unique screenshot; analyzes that one screenshot against
 * ALL of the criteria for which it was selected in Step 3. The model emits
 * a JSON array of per-criterion analyses (screenshot_evidence,
 * criterion_analysis, discrepancies, environment_issues_confirmed, optional
 * condition_verification).
 *
 * Variables:
 *   - task_definition         — task instruction
 *   - init_url_context        — optional "Starting URL: ..." appendix
 *   - action_history          — compact action history (for COMPARISON only —
 *                                the prompt is explicit that this is not a
 *                                description of the screenshot)
 *   - agent_predicted_output  — final answer / message
 *   - criteria_info_block     — pre-formatted block describing every criterion
 *                                the model should analyze against this image
 *                                (built by orchestration layer)
 */
export const MM_SCREENSHOT_BATCHED_EVIDENCE_ANALYSIS_PROMPT = `Task: $task_definition$init_url_context

**Action History:**
$action_history

**Agent's Predicted Output (Final Answer):**
$agent_predicted_output

**You are given a SINGLE screenshot (the image attached to this message). You must analyze this ONE screenshot against MULTIPLE rubric criteria listed below. Produce one analysis entry per criterion, all based on the SAME screenshot image.**

**Criteria to evaluate against this screenshot:**
$criteria_info_block

**CRITICAL — Ground Your Analysis in the ACTUAL Screenshot Pixels:**
You MUST describe ONLY what is LITERALLY VISIBLE in the attached screenshot image. Do NOT assume, infer, or fill in content based on the Action History or Predicted Output.
- READ the actual text rendered in the screenshot: dropdown/filter labels, table headers, column values, date ranges, page titles.
- If a dropdown says "Regular Season", do NOT describe it as "Postseason". If dates only go up to March, do NOT claim April dates are visible.
- If the screenshot does not show information relevant to a criterion, say so explicitly — do NOT fabricate evidence to match the agent's claims.
- The Action History and Predicted Output are provided for COMPARISON purposes only — to help you identify discrepancies between what the agent claimed and what the screenshot actually shows. They are NOT a description of the screenshot content.

**IMPORTANT — Criteria About the Agent's Output:**
Some criteria evaluate the quality, correctness, or completeness of the agent's final output (e.g., "Provide a step-by-step summary," "Report the price," "List the results"). For these criteria:
- The agent's output IS provided above in "Agent's Predicted Output." This is also typically the message associated with the agent's last action.
- Use the screenshots to VERIFY whether the output is correct, accurate, and supported by what is visible on screen — NOT to determine whether an output exists.
- If the criterion is about the agent's output, check whether the predicted output matches, contradicts, or is unsupported by the visual evidence in the screenshot.
- Only penalize if the output is factually wrong, hallucinated, or contradicted by the screenshots — NOT because the output is "not visible in the screenshot" (outputs are delivered as text, not rendered on-screen).

**Analysis Requirements (produce these for EACH criterion listed above, all from the SAME attached screenshot):**

1. **screenshot_evidence**: Describe what information is ACTUALLY VISIBLE in the screenshot that relates to this criterion. Be specific and objective. You MUST read and transcribe the actual text from the image — do not paraphrase from the Action History. Include:
   - What text, images, UI elements are visible? (Read them from the pixels.)
   - What state is the page/interface in? (What do the dropdowns, filters, tabs actually say?)
   - What data or information is displayed? (What are the actual date ranges, values, labels shown?)

2. **criterion_analysis**: Based on the screenshot, the agent's intermediate thoughts/actions, and especially the agent's predicted output, analyze how the evidence indicates:
   - Success: Does the screenshot confirm the criterion was fully satisfied? Does the agent's predicted output correctly reflect what is shown?
   - Partial success: Does it show partial progress or partial satisfaction?
   - Failure: Does it show the criterion was not satisfied, or that the agent's output is incorrect/hallucinated?
   - Provide specific reasoning based on visible evidence
   - **For output-quality criteria**: If the agent delivered a predicted output that addresses the criterion, evaluate whether that output is accurate and consistent with what the screenshots show. Do NOT give zero credit simply because the output text is not rendered on screen.

3. **discrepancies**: Compare what the agent CLAIMED to do (from Action History and Predicted Output) versus what the screenshot ACTUALLY SHOWS. Identify any mismatches:
   - Did the agent claim something that isn't visible in the screenshot?
   - Did the agent miss information that IS visible in the screenshot?
   - Does the agent's predicted output contain information that is contradicted by the screenshot?
   - Does the agent's predicted output contain hallucinated information not supported by any screenshot?
   - Example: Agent says "no videos over 20 mins found" but screenshot shows video thumbnails with "1:36:00" duration visible
   - Example: Agent's predicted output lists steps from a guide, and the screenshot confirms those steps are on the page — this is CONSISTENT, not a discrepancy

4. **environment_issues_confirmed**: Does the screenshot show environmental blockers that prevented task completion? Check for:
   - CAPTCHAs or bot detection pages
   - Login walls or authentication requirements
   - Out of stock / unavailable messages
   - Error pages or server issues
   - Site downtime or access restrictions
   - IMPORTANT: Only mark as confirmed if VISUALLY PRESENT in screenshot

5. **condition_verification** (ONLY for criteria marked as CONDITIONAL above): Based on what you see in the screenshot, verify whether the condition is actually met.
   - Output true if the condition IS met (criterion should be evaluated)
   - Output false if the condition is NOT met (criterion should be skipped)
   - OMIT this field entirely for non-conditional criteria

**Output Format:**
Output a JSON object with a single key "analyses" containing a list. The list must have exactly one entry per criterion above, in order.

{{
  "analyses": [
    {{
      "criterion_idx": <criterion number>,
      "screenshot_evidence": "...",
      "criterion_analysis": "...",
      "discrepancies": "...",
      "environment_issues_confirmed": true/false
    }},
    ...one object per criterion...
  ]
}}

For CONDITIONAL criteria (marked above), also include "condition_verification": true/false in that entry.

Example — 3 criteria (0, 1, 2) evaluated against ONE screenshot:
{{
  "analyses": [
    {{
      "criterion_idx": 0,
      "screenshot_evidence": "The screenshot shows a search results page with...",
      "criterion_analysis": "The results confirm the agent found the correct item...",
      "discrepancies": "None — the agent's claims match the visual evidence.",
      "environment_issues_confirmed": false
    }},
    {{
      "criterion_idx": 1,
      "screenshot_evidence": "The same screenshot also shows a price label reading $$24.99...",
      "criterion_analysis": "The price matches the agent's predicted output...",
      "discrepancies": "None.",
      "environment_issues_confirmed": false
    }},
    {{
      "criterion_idx": 2,
      "screenshot_evidence": "The screenshot does not show any checkout page or cart...",
      "criterion_analysis": "No evidence of checkout completion is visible...",
      "discrepancies": "Agent claimed checkout was completed but this screenshot shows search results.",
      "environment_issues_confirmed": false
    }}
  ]
}}

DO NOT OUTPUT ANYTHING OTHER THAN JSON.
`;
