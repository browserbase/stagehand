/**
 * Verbatim ports of microsoft/fara's MMRubricAgent prompts.
 *
 * Wave 1 ships the two prompts needed for a coarse outcome-only pipeline:
 *   - RUBRIC_GENERATION_PROMPT (Step 0a) — generate a rubric from the task
 *     description alone, used when TaskSpec.precomputedRubric is absent.
 *   - OUTCOME_VERIFICATION_PROMPT (Step 8) — independent binary success
 *     verdict given the trajectory + rubric.
 *
 * Wave 2+ adds: Step 0b (rubric dependency check), Step 2 (screenshot
 * relevance), Step 4 (per-criterion evidence analysis), Step 6 (multimodal
 * rescoring), Step 9a (failure analysis), Step 10 (task validity).
 */
export { RUBRIC_GENERATION_PROMPT } from "./rubricGeneration.js";
export { OUTCOME_VERIFICATION_PROMPT } from "./outcomeVerification.js";
export { RUBRIC_RESCORING_PROMPT } from "./rubricRescoring.js";
export {
  FIRST_POINT_OF_FAILURE_PROMPT,
  parseFailureStepNumbers,
} from "./firstPointOfFailure.js";
export { TASK_VALIDITY_PROMPT } from "./taskValidity.js";
export { MM_SCREENSHOT_CRITERION_RELEVANCE_PROMPT } from "./screenshotRelevance.js";
export { MM_BATCHED_RELEVANCE_PROMPT } from "./batchedRelevance.js";
export { MM_SCREENSHOT_BATCHED_EVIDENCE_ANALYSIS_PROMPT } from "./evidenceAnalysis.js";
export { MM_PER_CRITERION_SCORE_PROMPT } from "./perCriterionScore.js";
export { FUSED_JUDGMENT_PROMPT } from "./fusedJudgment.js";
export { FUSED_OUTCOME_PROMPT } from "./fusedOutcome.js";
export { renderPrompt, buildInitUrlContext } from "./render.js";
