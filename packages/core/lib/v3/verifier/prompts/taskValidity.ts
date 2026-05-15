/**
 * Task validity classification prompt — Step 10 of the rubric verifier
 * pipeline.
 *
 * Task-only verification — classifies the task itself (without trajectory
 * context) along two axes:
 *   - Ambiguity (taxonomy category 7) — underspecified or admits multiple
 *     valid interpretations
 *   - Validity (taxonomy category 8) — impossible / illegal / NSFW / RAI
 *
 * Diagnostic signal only. Populates EvaluationResult.taskValidity.
 *
 * Variables substituted at call time:
 *   - task_definition
 *   - url
 *   - apps
 *   - date
 */
import { getTaxonomyText } from "../errorTaxonomy.js";

// Axis definitions used by the task-level validity prompt.
const AXIS1_AMBIGUITY_DEFINITION = `A task is **ambiguous** when it is missing critical information that would prevent a reasonable agent from completing it correctly, or when the description admits multiple valid interpretations that cannot be resolved from context alone.

A task is **not ambiguous** if a competent agent could reasonably infer a single correct course of action from the task description and the given URL/app, even if minor details (like output formatting) are underspecified.

**NOTE:** For tasks that provide a URL, website, or app, this context is considered part of the specification and may resolve otherwise ambiguous parameters.`;

const AXIS2_INVALID_DEFINITION = `A task is **invalid** when it cannot be completed due to inherent constraints, or when it is illegal, NSFW, or violates Responsible AI principles. These are properties of the task itself, not of the agent's execution.

A task is **not invalid** if a competent agent could, in principle, accomplish the goal using standard computer interactions in its environment, even if the task is complex, time-consuming, or requires many steps.

Do NOT confuse impossibility with ambiguity. An ambiguous task (missing details) may still be possible if the agent can make reasonable assumptions.`;

// Sub-category bullets from the error taxonomy (categories 7 and 8).
const CAT7_BULLETS = getTaxonomyText(7, 7, 4);
const CAT8_BULLETS = getTaxonomyText(8, 8, 4);

export const TASK_VALIDITY_PROMPT = `You are an expert failure analyst for computer-use web agents.

You will analyze a single task **before execution** to identify whether it suffers from task-level issues that would prevent or compromise successful completion. Specifically, you will classify the task along two axes drawn from a standardized error taxonomy:

1. **Task Ambiguity (Category 7)** — Is the task ambiguous or underspecified?
2. **Invalid Task (Category 8)** — Is the task impossible, illegal, NSFW, or a Responsible AI violation?

A computer-use agent can interact with a full desktop environment: web browsers, desktop applications, file systems, terminals, and any GUI-based software.

---

## Axis 1 — Task Ambiguity (Category 7)

${AXIS1_AMBIGUITY_DEFINITION}

${CAT7_BULLETS}

**EXAMPLES OF NON-AMBIGUOUS TASKS**
1. Task: "Find the cheapest round-trip flight from San Francisco to Tokyo departing on June 15 and returning June 22, 2026." URL: "https://www.google.com/flights" — origin, destination, dates, trip type, and optimization criterion are all specified.
2. Task: "Add a 16oz bag of Starbucks Pike Place ground coffee to the cart." URL: "https://www.amazon.com/" — the product, size, and action are specific enough.

**EXAMPLES OF AMBIGUOUS TASKS**
1. Task: "Browse apartments with at least 2 bedrooms…" URL: "https://craigslist.org/" — Craigslist requires a city; this is underspecified (7.1).
2. Task: "Book a flight from NYC to London." URL: "https://www.google.com/flights" — travel dates not specified (7.1).
3. Task: "Highlight over 'the' in file.docx" — open to multiple interpretations when multiple instances exist (7.2).

---

## Axis 2 — Invalid Task (Category 8)

${AXIS2_INVALID_DEFINITION}

${CAT8_BULLETS}

**EXAMPLES OF VALID TASKS**
1. "Find the cheapest round-trip flight from San Francisco to Tokyo." on Google Flights — site supports flight search.
2. "Submit a job application for a software engineering role." on careers.google.com — site supports it.

**EXAMPLES OF INVALID TASKS**
1. "Log into my personal bank account…" — agent has no credentials (8.1 impossible).
2. "Book a hotel room on LinkedIn." — LinkedIn is professional networking, not a travel site (8.1).
3. "Download and launch GTA 6." — non-existent entity at time of release (8.1).
4. Drug/piracy/prostitution-related tasks → 8.2 (illegal).
5. NSFW-redirecting tasks → 8.3.
6. Fraud, harassment, surveillance, discriminatory targeting → 8.2 / 8.4 (illegal + RAI).

---

## Context

Task: $task_definition

URL: $url

Applications: $apps

Current Date: $date

## Instructions

Analyze the task across both axes. For each axis, provide reasoning and a classification. Be precise: only flag genuine issues that would materially affect task completion.

**Guiding principles:**
- A task that is merely difficult, tedious, or multi-step is NOT impossible.
- A task that has minor formatting ambiguity is NOT ambiguous.
- The current date is provided to help assess time-sensitive impossibility (e.g., expired events, future releases).

**IMPORTANT**
Output your answer in pure JSON format according to the following schema. The JSON object must be parsable as-is. DO NOT OUTPUT ANYTHING OTHER THAN JSON, AND DO NOT DEVIATE FROM THIS SCHEMA:

{{
    "reasoning_is_ambiguous": str,
    "is_ambiguous": bool,
    "ambiguity_codes": [str],
    "reasoning_is_invalid": str,
    "is_invalid": bool,
    "invalid_task_codes": [str]
}}
`;
