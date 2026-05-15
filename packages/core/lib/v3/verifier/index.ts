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
  AgentEvidence,
  AgentEvidenceModality,
  ProbeEvidence,
  ToolOutput,
} from "./trajectory.js";
export { loadTrajectoryFromDisk, nextVerdictFilename } from "./trajectory.js";

export type {
  Verifier,
  Verdict,
  CriterionScore,
  FirstPointOfFailure,
  TaskValidity,
  VerifierFinding,
  StubVerdictReason,
} from "./verifier.js";
