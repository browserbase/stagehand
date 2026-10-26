/**
 * Public re-exports for the verifier subsystem.
 */
export type {
  AgentEvidence,
  AgentEvidenceModality,
  CanonicalEvidence,
  CanonicalScreenshot,
  CanonicalTextEvidence,
  CriterionScore,
  EvaluationResult,
  ErrorTaxonomyCategory,
  ErrorTaxonomySubCategory,
  EvidenceLoadOptions,
  EvidenceLoadResult,
  FirstPointOfFailure,
  ParseFailureStepNumbersOptions,
  ProbeEvidence,
  Rubric,
  RubricCriterion,
  RubricVerifierOptions,
  TaskSpec,
  TaskValidity,
  ToolOutput,
  Trajectory,
  TrajectoryStatus,
  TrajectoryStep,
  TrajectoryUsage,
  Verifier,
  VerifierConfig,
  VerifierFinding,
  VerifierRawSteps,
} from "./types.js";
export {
  buildAgentEvidenceFromStepFinished,
  collectInlineImagePayloads,
  mergeAgentEvidence,
  redactInlineImagePayloads,
  REDACTED_INLINE_IMAGE,
} from "./evidenceNormalization.js";
export {
  loadTrajectoryFromDisk,
  nextResultFilename,
  normalizeRubric,
  shouldPersistTrajectory,
  writeTrajectoryDir,
} from "./trajectory.js";
export { RubricVerifier, resolveVerifierConfig } from "./rubricVerifier.js";
export { AISdkJudge, createModel, resolveModelName, DEFAULT_VERIFIER_MODEL } from "./client.js";
export { Evaluator } from "./evaluator.js";
export type { EvaluatorOptions } from "./evaluator.js";
export { detectBrowserUse, executionIssues } from "./diagnostics.js";
export type { LLMClient, CompletionRequest, LogLine } from "./client.js";

export type { OutcomeChecks } from "./outcomeChecks.js";
export { answerStructure, describeAnswerStructure, unwrapAnswer } from "./answerStructure.js";
export { detectRubricFallbacks, describeRubricFallbacks } from "./rubricFallback.js";
export { loadApiKeyFromEnv, KEYLESS_JUDGE_PROVIDERS } from "./client.js";
