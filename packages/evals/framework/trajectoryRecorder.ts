import fs from "node:fs/promises";
import path from "node:path";
import {
  buildAgentEvidenceFromStepFinished,
  mergeAgentEvidence,
  redactInlineImagePayloads,
  shouldPersistTrajectory,
  writeTrajectoryDir,
} from "@browserbasehq/stagehand";
import type {
  AgentEvidence,
  AgentEvidenceEvent,
  AgentFinalAnswerEvent,
  AgentScreenshotEvidenceEvent,
  AgentStepFinishedEvent,
  AgentStepObservedEvent,
  ProbeEvidence,
  TaskSpec,
  Trajectory,
  TrajectoryStatus,
  TrajectoryStep,
  TrajectoryUsage,
  EvaluationResult,
} from "@browserbasehq/stagehand";

interface PendingScreenshot {
  screenshot: Buffer;
  url: string;
}

export interface TrajectoryRecorderOptions {
  taskSpec: TaskSpec;
  /**
   * Root directory under which trajectory dirs are written. Each task run
   * gets a subdirectory named by runId/task.id.
   * Defaults to `<cwd>/.trajectories`.
   */
  outputRoot?: string;
  /** Run identifier (e.g., ISO timestamp + env). Defaults to a fresh timestamp. */
  runId?: string;
  /**
   * Override the env-gated persistence default. `true` always persists,
   * `false` never does, `undefined` defers to VERIFIER_PERSIST_TRAJECTORIES.
   */
  persist?: boolean;
}

export interface TrajectoryFinishOptions {
  status: TrajectoryStatus;
  finalAnswer?: string;
  usage?: Partial<TrajectoryUsage>;
}

const ZERO_USAGE: TrajectoryUsage = {
  input_tokens: 0,
  output_tokens: 0,
};

export class TrajectoryRecorder {
  private readonly taskSpec: TaskSpec;
  private readonly runId: string;
  private readonly outputDir: string;
  private readonly persistEnabled: boolean;

  // Steps are appended in arrival order on each step_finished event.
  private readonly steps: TrajectoryStep[] = [];
  // The most recent agent-role screenshot is held until the next step_finished
  // consumes it. A second agent-role screenshot before any step_finished
  // overwrites the first — that's the desired behavior when a turn is skipped
  // (e.g., captcha guard short-circuits before emitting step_finished).
  private pendingAgentScreenshot?: PendingScreenshot;
  // The most recent probe-role screenshot waits for the matching step_observed.
  private pendingProbeScreenshot?: PendingScreenshot;
  // Steps that haven't yet had a probe attached. The next step_observed fans
  // out to all of them (one probe per agent turn, N tool calls per turn).
  private stepsAwaitingProbe: number[] = [];
  private finalAnswerEvent?: AgentFinalAnswerEvent;
  private finalObservation?: ProbeEvidence;

  private onScreenshot(e: AgentScreenshotEvidenceEvent): void {
    const role = e.evidenceRole ?? "probe";
    if (role === "agent") {
      this.pendingAgentScreenshot = { screenshot: e.screenshot, url: e.url };
    } else {
      this.pendingProbeScreenshot = { screenshot: e.screenshot, url: e.url };
    }
  }

  private onStepFinished(e: AgentStepFinishedEvent): void {
    const agentEvidence: AgentEvidence = this.pendingAgentScreenshot
      ? mergeAgentEvidence(
          { modalities: [] },
          {
            modalities: [
              {
                type: "image",
                bytes: this.pendingAgentScreenshot.screenshot,
                mediaType: "image/png",
              },
            ],
          },
        )
      : { modalities: [] };
    const merged = mergeAgentEvidence(
      agentEvidence,
      buildAgentEvidenceFromStepFinished(e),
    );

    const step: TrajectoryStep = {
      index: this.steps.length,
      actionName: e.actionName,
      actionArgs: e.actionArgs,
      reasoning: e.reasoning,
      agentEvidence: merged,
      probeEvidence: {},
      toolOutput: {
        ...e.toolOutput,
        result: redactInlineImagePayloads(e.toolOutput.result, e.actionName),
      },
    };
    this.pendingAgentScreenshot = undefined;
    this.steps.push(step);
    this.stepsAwaitingProbe.push(step.index);
  }

  private onStepObserved(e: AgentStepObservedEvent): void {
    if (this.stepsAwaitingProbe.length === 0) return;
    const probe: ProbeEvidence = { url: e.url };
    if (this.pendingProbeScreenshot)
      probe.screenshot = this.pendingProbeScreenshot.screenshot;
    if (e.ariaTree !== undefined) probe.ariaTree = e.ariaTree;
    if (e.scroll !== undefined) probe.scroll = e.scroll;
    for (const idx of this.stepsAwaitingProbe) {
      this.steps[idx].probeEvidence = probe;
    }
    this.stepsAwaitingProbe = [];
    this.pendingProbeScreenshot = undefined;
  }

  private onFinalAnswer(e: AgentFinalAnswerEvent): void {
    this.finalAnswerEvent = e;
    if (e.observation) {
      this.finalObservation = {
        url: e.observation.url,
        ...(e.observation.screenshot
          ? { screenshot: e.observation.screenshot }
          : {}),
        ...(e.observation.ariaTree !== undefined
          ? { ariaTree: e.observation.ariaTree }
          : {}),
        ...(e.observation.scroll !== undefined
          ? { scroll: e.observation.scroll }
          : {}),
      };
    }
  }

  constructor(opts: TrajectoryRecorderOptions) {
    this.taskSpec = opts.taskSpec;
    this.runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
    const root = opts.outputRoot ?? path.join(process.cwd(), ".trajectories");
    this.outputDir = path.join(root, this.runId, opts.taskSpec.id);
    this.persistEnabled = shouldPersistTrajectory(opts.persist);
  }

  /** Mark the beginning of collection. Retained as a no-op for compatibility. */
  start(): void {
    return;
  }

  /** Ingest an evidence callback event from agent.execute(). */
  record(event: AgentEvidenceEvent): void {
    switch (event.type) {
      case "screenshot":
        this.onScreenshot(event);
        break;
      case "step_finished":
        this.onStepFinished(event);
        break;
      case "step_observed":
        this.onStepObserved(event);
        break;
      case "final_answer":
        this.onFinalAnswer(event);
        break;
    }
  }

  /**
   * Detach listeners, assemble the Trajectory, and (if persistence is on)
   * write the on-disk layout. Idempotent.
   */
  async finish(opts: TrajectoryFinishOptions): Promise<Trajectory> {
    const trajectory: Trajectory = {
      task: this.taskSpec,
      steps: this.steps,
      finalAnswer: opts.finalAnswer ?? this.finalAnswerEvent?.message,
      ...(this.finalObservation
        ? { finalObservation: this.finalObservation }
        : {}),
      status: opts.status,
      usage: { ...ZERO_USAGE, ...(opts.usage ?? {}) },
    };

    if (this.persistEnabled) {
      await writeTrajectoryDir(this.outputDir, trajectory);
    }

    return trajectory;
  }

  /** Throw away in-memory state without writing to disk. Used on early abort. */
  cancel(): void {
    this.steps.length = 0;
    this.pendingAgentScreenshot = undefined;
    this.pendingProbeScreenshot = undefined;
    this.stepsAwaitingProbe = [];
    this.finalAnswerEvent = undefined;
    this.finalObservation = undefined;
  }

  /** Where the trajectory dir lives (whether or not it was persisted). */
  get directory(): string {
    return this.outputDir;
  }

  /** Whether this recorder wrote the trajectory directory on finish(). */
  get persisted(): boolean {
    return this.persistEnabled;
  }

  /**
   * Persist evaluator result next to the trajectory. No-op when trajectory
   * persistence is disabled.
   */
  async persistResult(
    result: EvaluationResult,
    filename = "result.json",
  ): Promise<void> {
    if (!this.persistEnabled) return;

    const scoresDir = path.join(this.outputDir, "scores");
    await fs.mkdir(scoresDir, { recursive: true });
    await fs.writeFile(
      path.join(scoresDir, filename),
      JSON.stringify(result, null, 2),
    );

    const taskDataPath = path.join(this.outputDir, "task_data.json");
    let taskData: Record<string, unknown>;
    try {
      taskData = JSON.parse(await fs.readFile(taskDataPath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      taskData = { task: this.taskSpec };
    }
    await fs.writeFile(
      taskDataPath,
      JSON.stringify({ ...taskData, result }, null, 2),
    );
  }
}
