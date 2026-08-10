/**
 * Evidence events emitted through AgentExecuteOptions.callbacks.onEvidence.
 *
 * These events describe observations made by Stagehand during an agent run.
 * They are emitted in temporal order; consumers should treat the stream as
 * sequential. An agent-role screenshot applies to every subsequent
 * step_finished until a newer agent-role screenshot replaces it — a CUA
 * provider may choose multiple actions from a single screenshot, so each of
 * those steps shares that frame. A step_observed/probe applies to all
 * step_finished events received since the last probe. Verifier-specific
 * storage and normalization live in the evals/verifier layers.
 */

export type AgentEvidenceRole = "probe" | "agent";

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
  /** PNG bytes from page.screenshot(). */
  screenshot: Buffer;
  /** Page URL at the time of capture. */
  url: string;
  /** Role this screenshot plays in downstream evidence collection. */
  evidenceRole: AgentEvidenceRole;
}

/**
 * One completed agent tool/action step.
 */
export interface AgentStepFinishedEvent {
  type: "step_finished";
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
}

/**
 * Independent post-step browser observation. Emitted once per agent turn;
 * consumers apply it to every step_finished received since the previous probe.
 */
export interface AgentStepObservedEvent {
  type: "step_observed";
  /** Page URL after the step's tool/action execution. */
  url: string;
  /** Accessibility tree snapshot, when captured. */
  ariaTree?: string;
}

export interface AgentFinalObservation {
  /** Page URL at the time of terminal capture. */
  url: string;
  /** PNG bytes from page.screenshot(), when capture succeeds. */
  screenshot?: Buffer;
  /** Accessibility tree snapshot, when captured. */
  ariaTree?: string;
}

/** Final answer emitted by the agent, when available. */
export interface AgentFinalAnswerEvent {
  type: "final_answer";
  /** The agent's final summary message. */
  message: string;
  /** Optional structured output if the agent's output schema was set. */
  output?: Record<string, unknown>;
  /**
   * Independent terminal browser observation captured after the agent finishes.
   *
   * This preserves the legacy verifier behavior of evaluating against a final
   * page screenshot even when the last agent output is a final answer rather
   * than a browser action.
   */
  observation?: AgentFinalObservation;
}

export type AgentEvidenceCallback = (
  event: AgentEvidenceEvent,
) => PromiseLike<void> | void;
