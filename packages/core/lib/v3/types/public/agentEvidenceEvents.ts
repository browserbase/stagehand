/**
 * Evidence events emitted through AgentExecuteOptions.callbacks.onEvidence.
 *
 * These events describe observations made by Stagehand during an agent run.
 * They are intentionally transport-level callback payloads; verifier-specific
 * storage and normalization live in the evals/verifier layers.
 */

export type AgentEvidenceRole = "probe" | "agent" | "agent_and_probe";

export type AgentEvidenceEvent =
  | AgentScreenshotEvidenceEvent
  | AgentStepFinishedEvent
  | AgentStepObservedEvent
  | AgentFinalAnswerEvent;

/**
 * Screenshot captured during an agent run.
 *
 * In DOM/hybrid mode, post-tool screenshots are probe evidence. In CUA mode,
 * screenshots captured by the screenshot provider are agent evidence because
 * they are the exact bytes sent to the provider.
 */
export interface AgentScreenshotEvidenceEvent {
  type: "screenshot";
  /** Zero-based index of the step this screenshot corresponds to. */
  stepIndex: number;
  /** PNG bytes from page.screenshot(). */
  screenshot: Buffer;
  /** Page URL at the time of capture. */
  url: string;
  /** Role this screenshot plays in downstream evidence collection. */
  evidenceRole?: AgentEvidenceRole;
}

/**
 * One completed agent tool/action step.
 */
export interface AgentStepFinishedEvent {
  type: "step_finished";
  stepIndex: number;
  /** Name of the tool/action that ran, e.g. "act", "extract", "click". */
  actionName: string;
  /** Arguments passed to the tool/action. */
  actionArgs: Record<string, unknown>;
  /** Agent textual reasoning for the step, when available. */
  reasoning: string;
  /** Outcome of the tool/action as seen by Stagehand. */
  toolOutput: {
    ok: boolean;
    /** Native return value from the tool/action. */
    result: unknown;
    error?: string;
  };
  /** ISO 8601 timestamp at which the step finished. */
  finishedAt: string;
}

/**
 * Independent post-step browser observation.
 */
export interface AgentStepObservedEvent {
  type: "step_observed";
  stepIndex: number;
  /** Page URL after the step's tool/action execution. */
  url: string;
  /** Accessibility tree snapshot, when captured. */
  ariaTree?: string;
  /** Viewport scroll context, when captured. */
  scroll?: { top: number; pageHeight: number };
}

/** Final answer emitted by the agent, when available. */
export interface AgentFinalAnswerEvent {
  type: "final_answer";
  /** The agent's final summary message. */
  message: string;
  /** Optional structured output if the agent's output schema was set. */
  output?: Record<string, unknown>;
}

export type AgentEvidenceCallback = (
  event: AgentEvidenceEvent,
) => PromiseLike<void> | void;
