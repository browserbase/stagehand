/**
 * Verifier — interface and result types for the rubric-based verifier that
 * replaces V3Evaluator's single-pass YES/NO judge.
 *
 * Modeled on rubric-based verifier pipelines for computer-use agents. The
 * verifier never touches a live browser — it consumes a Trajectory + TaskSpec
 * and returns a structured Verdict. That property is what lets us re-score
 * saved trajectories offline.
 *
 * Wave 0 ships only the types and a stub implementation (`evidence_insufficient`
 * for everything). Wave 1 adds the rubric generation/scoring pipeline.
 */

import type { Trajectory, TaskSpec } from "./trajectory.js";

/** Score for a single rubric criterion after evidence analysis + rescoring. */
export interface CriterionScore {
  /** Matches RubricCriterion.criterion (the criterion's short name). */
  criterion: string;
  /** Maximum possible points for this criterion. */
  maxPoints: number;
  /**
   * Points earned post-evidence-analysis (paper's post_image_earned_points).
   * Null if the criterion was conditional and its condition wasn't met (excluded
   * from both numerator and denominator in the process score).
   */
  earnedPoints: number | null;
  /** Verifier's free-text justification for the score. */
  justification: string;
  /**
   * True if the criterion is conditional and its condition was determined to
   * be met. Absent for non-conditional criteria.
   */
  conditionMet?: boolean;
  /**
   * Set when the verifier had no evidence to ground this criterion in either
   * tier. Per paper §2, treated as uncontrollable failure → full credit, but
   * surfaced here so dashboards can flag low-confidence verdicts.
   */
  evidenceInsufficient?: boolean;
}

/**
 * First-point-of-failure analysis (paper Step 9a). Identifies the earliest
 * step where the agent's trajectory went off-track, using a structured error
 * taxonomy (7 top-level categories, 1.1–7.4 sub-codes).
 */
export interface FirstPointOfFailure {
  stepIndex: number;
  /** Sub-code from the error taxonomy (e.g., "2.3" for a specific hallucination type). */
  errorCode: string;
  /** Top-level category name (Selection, Hallucination, etc.). */
  category: string;
  /** Verifier's reasoning for selecting this point. */
  description?: string;
}

/**
 * Structured observation surfaced by the verifier that another agent or
 * tooling could act on. Findings are emitted opportunistically by Step 8
 * (outcome verification) when the verifier notices actionable patterns —
 * repeated tool-call failures, ambiguous task specs, evidence gaps, etc.
 *
 * Not produced for every task: when nothing actionable surfaces, the
 * `findings` array on the Verdict is empty. Consumers should treat the
 * field as advisory, not as part of the formal score.
 */
export interface VerifierFinding {
  /**
   * Category of the observation. Open-ended enum — additional categories may
   * be added as Wave 2/3 verifier steps surface new failure modes.
   */
  category:
    | "agent_tool_usage" // agent's tool calls had repeated issues (misclicks, wrong args, retries)
    | "agent_strategy" // higher-level planning / decision-making problems
    | "rubric_quality" // criteria were overly strict, ambiguous, or contradictory
    | "trajectory_capture" // gaps in evidence (missing screenshots, empty steps)
    | "task_specification" // task instruction was ambiguous / under- or over-specified
    | "verifier_uncertainty" // verifier itself couldn't confidently decide
    | "other";
  /** Impact: info (FYI), warning (worth investigating), blocking (broke the task). */
  severity: "info" | "warning" | "blocking";
  /** What the verifier noticed. Plain prose, grounded in evidence from the trajectory. */
  description: string;
  /**
   * Optional concrete next action another agent could take. Should be
   * specific enough that it can be acted on without further reasoning —
   * e.g., "Try double_click instead of triple_click to clear placeholder
   * text on this form field."
   */
  suggestedAction?: string;
  /** Step indices in the trajectory where this pattern showed up. */
  relatedSteps?: number[];
}

/** Stable debugging summary emitted by verifier backends. */
export interface VerifierRawSteps {
  backend?: "legacy" | "verifier";
  primaryIntent?: string;
  reasoning?: string;
  rubricSource?: "precomputed" | "generated" | "none";
  approach?: "a" | "b";
  optionalsMode?: "folded" | "separate" | "skip";
  totalEarned?: number;
  totalMax?: number;
  evidenceImages?: number;
  evidenceTexts?: number;
  evidenceOriginalScreenshots?: number;
  legacyEvaluation?: string;
  screenshotCount?: number;
}

/** Task-validity classification (paper Step 10). */
export interface TaskValidity {
  /** True if the task is underspecified / has multiple valid interpretations. */
  isAmbiguous: boolean;
  /** True if the task is impossible / illegal / NSFW / otherwise infeasible. */
  isInvalid: boolean;
  /** Optional sub-codes from the task-classification taxonomy. */
  ambiguityCodes?: string[];
  invalidTaskCodes?: string[];
}

/**
 * The verifier's output. Process score + outcome verdict + diagnostic signals.
 *
 * Process and outcome are deliberately independent (paper §2): an agent can
 * follow the right steps but get blocked (high process, low outcome), or
 * succeed through an unexpected path (variable process, high outcome).
 */
export interface Verdict {
  /** Step 8 — did the agent accomplish the task from the user's perspective? */
  outcomeSuccess: boolean;
  /** Aggregated earned/max across applicable criteria, in [0, 1]. */
  processScore: number;
  /** Per-criterion breakdown after rescoring. */
  perCriterion: CriterionScore[];
  /** Step 9a — first step where the trajectory went off-track, if any. */
  firstPointOfFailure?: FirstPointOfFailure;
  /** Step 10 — task-itself ambiguity / validity. */
  taskValidity: TaskValidity;
  /**
   * Ids (RubricCriterion.criterion strings) of criteria where neither tier of
   * evidence resolved the question. Treated as uncontrollable → full credit,
   * but flagged here so consumers can decide whether to discount the score.
   */
  evidenceInsufficient: string[];
  /**
   * Structured observations from the verifier that a downstream tool or
   * follow-up agent could act on. Opportunistic — empty when the verifier
   * doesn't notice anything actionable. Not part of the score; advisory.
   */
  findings?: VerifierFinding[];
  /** Debugging summary from the active evaluator backend. */
  rawSteps?: VerifierRawSteps;
}

/** Reason a stub verifier emits when the rubric pipeline hasn't shipped yet. */
export type StubVerdictReason =
  | "wave-0-stub"
  | "no-rubric"
  | "empty-trajectory";

/**
 * Verifier interface. Implementations consume a Trajectory + TaskSpec and
 * return a Verdict — they MUST NOT touch a live browser.
 */
export interface Verifier {
  verify(trajectory: Trajectory, taskSpec: TaskSpec): Promise<Verdict>;
}
