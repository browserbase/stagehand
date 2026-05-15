/**
 * Public re-exports for the verifier subsystem.
 *
 * Wave 0 ships the trajectory + verdict types and a stub verifier. The
 * RubricVerifier port (Wave 1+) stays internal until the prompts stabilize.
 */
export type {
  Trajectory,
  TrajectoryStep,
  TrajectoryStatus,
  TrajectoryUsage,
  TaskSpec,
  Rubric,
  RubricCriterion,
  SerializedRubric,
  SerializedRubricCriterion,
  RubricInput,
  AgentEvidence,
  AgentEvidenceModality,
  ProbeEvidence,
  ToolOutput,
} from "./trajectory.js";
export {
  loadTrajectoryFromDisk,
  nextVerdictFilename,
  normalizeRubric,
} from "./trajectory.js";

export type {
  Verifier,
  Verdict,
  CriterionScore,
  FirstPointOfFailure,
  TaskValidity,
  VerifierFinding,
  VerifierRawSteps,
  StubVerdictReason,
} from "./verifier.js";
