/**
 * Bus event payloads emitted by V3 on `v3.bus`.
 *
 * The bus is an EventEmitter; these types document the payload shape per
 * event name so consumers (TrajectoryRecorder in packages/evals, custom
 * subscribers) can type their handlers.
 *
 * Wave 0 of the verifier rewrite plan introduces:
 *   - agent_screenshot_taken_event    — independent post-step screenshot probe
 *   - agent_step_finished_event       — fired per tool-call in a step result
 *   - agent_step_observed_event       — fired after the harness probe completes
 *   - agent_final_answer_event        — fired when the `done` tool resolves
 *
 * `agent_step_started_event` is documented in the plan but deferred — the AI
 * SDK's `onStepFinish` is a post-hook, and there's no symmetric pre-hook per
 * tool execution in v3AgentHandler today. Started-state can be derived from
 * the finished event's stepIndex if needed.
 */

/**
 * Names of bus events the agent handlers emit. Use these constants to
 * subscribe; the bus accepts arbitrary strings, but a centralized list helps
 * catch typos at the call site.
 */
export const BUS_EVENTS = {
  AGENT_SCREENSHOT_TAKEN: "agent_screenshot_taken_event",
  AGENT_STEP_FINISHED: "agent_step_finished_event",
  AGENT_STEP_OBSERVED: "agent_step_observed_event",
  AGENT_FINAL_ANSWER: "agent_final_answer_event",
} as const;

export type BusEventName = (typeof BUS_EVENTS)[keyof typeof BUS_EVENTS];

/**
 * Payload for `agent_screenshot_taken_event`. The raw screenshot Buffer the
 * harness took after a step's tool execution.
 *
 * Note: in CUA mode the same Buffer is also what the provider received; in
 * DOM/hybrid mode it's an independent harness probe. The verifier treats them
 * as different evidence tiers regardless — see plan §04 ("Mode-by-mode sources").
 */
export interface AgentScreenshotTakenEvent {
  /** Zero-based index of the step this screenshot corresponds to. */
  stepIndex: number;
  /** PNG bytes from page.screenshot(). */
  screenshot: Buffer;
  /** Page URL at the time of capture. */
  url: string;
  /**
   * Evidence role for this screenshot.
   *
   * DOM/hybrid post-tool screenshots are probe-only. CUA screenshots are also
   * the exact image bytes sent to the provider, so they serve both as tier-1
   * agent evidence and tier-2 probe evidence.
   */
  evidenceRole?: "probe" | "agent" | "agent_and_probe";
}

/**
 * Payload for `agent_step_finished_event`. Emitted once per tool call within
 * a step result. Carries the tool's reported outcome and a reference to the
 * agent's textual reasoning for the step.
 *
 * Tier 1 evidence (the bytes the LLM consumed as the tool result) is captured
 * separately by the harness via an AgentExecuteCallbacks.onStepFinish wrapper
 * — not in this payload. See plan §10 Q1 (resolved: onStepFinish).
 */
export interface AgentStepFinishedEvent {
  stepIndex: number;
  /** Name of the tool that ran (e.g., "act", "extract", "click"). */
  actionName: string;
  /** Arguments passed to the tool. */
  actionArgs: Record<string, unknown>;
  /** Agent's textual reasoning (event.text on the AI SDK StepResult). */
  reasoning: string;
  /** Outcome of the tool execution as seen by the harness. */
  toolOutput: {
    ok: boolean;
    /** The tool's native return value. */
    result: unknown;
    error?: string;
  };
  /** ISO 8601 timestamp at which the step finished. */
  finishedAt: string;
}

/**
 * Payload for `agent_step_observed_event`. Emitted after the harness probe
 * completes for a step (page URL captured at minimum; a11y tree and scroll
 * info added in Wave 2).
 */
export interface AgentStepObservedEvent {
  stepIndex: number;
  /** Page URL after the step's tool execution. */
  url: string;
  /** v1 — accessibility tree snapshot. */
  ariaTree?: string;
  /** v1 — viewport scroll context. */
  scroll?: { top: number; pageHeight: number };
}

/** Payload for `agent_final_answer_event`. Emitted when the `done` tool resolves. */
export interface AgentFinalAnswerEvent {
  /** The agent's final summary message. */
  message: string;
  /** Optional structured output if the agent's `output` schema was set. */
  output?: Record<string, unknown>;
}
