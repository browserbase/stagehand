import fs from "node:fs/promises";
import path from "node:path";
import {
  reserveTrajectoryDir,
  resolveTrajectoryDir,
  resolveTrajectoryGroup,
  resolveTrajectoryRoot,
  writeTrajectoryMetadata,
} from "./trajectoryGroup.js";
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

export interface TrajectoryRecorderOptions {
  taskSpec: TaskSpec;
  /**
   * Root directory under which trajectory dirs are written. The on-disk layout
   * is `<root>/<group>/<task.id>/<runId>/`, where <group> is the run-scoped
   * EVAL_TRAJECTORY_GROUP (experiment+model) or "default".
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
  private readonly outputRoot: string;
  // Captured at construction: the runner restamps EVAL_TRAJECTORY_GROUP per
  // experiment, so a recorder must write under the group it was created for
  // even if it finishes after the env moves on.
  private readonly group: string;
  // The on-disk reservation, made once (idempotently) by ensureReserved().
  private reserved?: { directory: string; attempt: number };
  // Reassigned by ensureReserved(): the constructor computes the un-reserved
  // path for the `directory` getter; the reservation replaces it with the dir
  // actually created on disk (which may carry a -2/-3 collision suffix).
  private outputDir: string;
  private readonly persistEnabled: boolean;

  // Steps are appended in arrival order on each step_finished event.
  private readonly steps: TrajectoryStep[] = [];
  // The most recent agent-role screenshot. It applies to every step_finished
  // until a newer agent-role screenshot replaces it — a CUA provider can pick
  // multiple actions from one screenshot, so each of those steps must carry
  // that same tier-1 frame. (It is NOT cleared on consume; it is only replaced
  // by a newer screenshot, or wiped on cancel().)
  private latestAgentScreenshot?: Buffer;
  // The most recent probe-role screenshot waits for the matching step_observed.
  private pendingProbeScreenshot?: Buffer;
  // Steps that haven't yet had a probe attached. The next step_observed fans
  // out to all of them (one probe per agent turn, N tool calls per turn).
  private stepsAwaitingProbe: number[] = [];
  private finalAnswerEvent?: AgentFinalAnswerEvent;
  private finalObservation?: ProbeEvidence;

  private onScreenshot(e: AgentScreenshotEvidenceEvent): void {
    if (e.evidenceRole === "agent") {
      this.latestAgentScreenshot = e.screenshot;
    } else {
      this.pendingProbeScreenshot = e.screenshot;
    }
  }

  private onStepFinished(e: AgentStepFinishedEvent): void {
    const modalities: AgentEvidence["modalities"] = [];
    if (this.latestAgentScreenshot) {
      modalities.push({
        type: "image",
        bytes: this.latestAgentScreenshot,
        mediaType: "image/png",
      });
    }
    const merged = mergeAgentEvidence(
      { modalities },
      buildAgentEvidenceFromStepFinished(e),
    );

    // Intentionally not cleared here: the same agent screenshot applies to
    // every step in a batched CUA turn. It's replaced when a newer agent
    // screenshot arrives (onScreenshot) or wiped on cancel().
    this.stepsAwaitingProbe.push(this.steps.length);
    this.steps.push({
      actionName: e.actionName,
      actionArgs: e.actionArgs,
      reasoning: e.reasoning,
      agentEvidence: merged,
      probeEvidence: {},
      toolOutput: {
        ...e.toolOutput,
        result: redactInlineImagePayloads(e.toolOutput.result, e.actionName),
      },
    });
  }

  private onStepObserved(e: AgentStepObservedEvent): void {
    const probe: ProbeEvidence = { url: e.url };
    if (this.pendingProbeScreenshot)
      probe.screenshot = this.pendingProbeScreenshot;
    if (e.ariaTree !== undefined) probe.ariaTree = e.ariaTree;
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
      };
    }
  }

  constructor(opts: TrajectoryRecorderOptions) {
    this.taskSpec = opts.taskSpec;
    this.runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
    // Same resolution as the entrypoint's experiment-link write, so the
    // EVAL_TRAJECTORY_ROOT override can't split them across two roots.
    this.outputRoot = opts.outputRoot ?? resolveTrajectoryRoot();
    this.group = resolveTrajectoryGroup();
    // Best-effort path for the `directory` getter before anything persists;
    // ensureReserved() replaces it with the dir actually created on disk.
    this.outputDir = resolveTrajectoryDir(
      this.outputRoot,
      opts.taskSpec.id,
      this.runId,
      this.group,
    );
    this.persistEnabled = shouldPersistTrajectory(opts.persist);
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
      const { directory, attempt } = await this.ensureReserved();
      await writeTrajectoryDir(directory, trajectory);
      await writeTrajectoryMetadata(directory, {
        task: this.taskSpec.id,
        runId: this.runId,
        runDir: path.basename(directory),
        attempt,
        status: opts.status,
      });
    }

    return trajectory;
  }

  /** Throw away in-memory state without writing to disk. Used on early abort. */
  cancel(): void {
    this.steps.length = 0;
    this.latestAgentScreenshot = undefined;
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
  /**
   * Reserve this recorder's on-disk directory exactly once. Reservation
   * happens at first persistence (not construction) so collision resolution
   * sees dirs concurrent recorders have actually created; the cached result
   * keeps finish() idempotent and makes finish()/persistResult() order-free.
   */
  private async ensureReserved(): Promise<{
    directory: string;
    attempt: number;
  }> {
    if (!this.reserved) {
      this.reserved = await reserveTrajectoryDir(
        this.outputRoot,
        this.taskSpec.id,
        this.runId,
        this.group,
      );
      this.outputDir = this.reserved.directory;
    }
    return this.reserved;
  }

  async persistResult(
    result: EvaluationResult,
    filename = "result.json",
  ): Promise<void> {
    if (!this.persistEnabled) return;

    // Route through the shared reservation so scores land in the same dir as
    // the trajectory regardless of finish()/persistResult() call order.
    const { directory } = await this.ensureReserved();
    const scoresDir = path.join(directory, "scores");
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
