import fs from "node:fs/promises";
import path from "node:path";
import {
  shouldPersistTrajectory,
  writeTrajectoryDir,
} from "@browserbasehq/stagehand";
import type {
  AgentEvidence,
  AgentFinalAnswerEvent,
  AgentScreenshotTakenEvent,
  AgentStepFinishedEvent,
  AgentStepObservedEvent,
  ProbeEvidence,
  TaskSpec,
  Trajectory,
  TrajectoryStatus,
  TrajectoryStep,
  TrajectoryUsage,
  EvaluationResult,
  V3,
} from "@browserbasehq/stagehand";

interface PartialStep {
  index: number;
  actionName: string;
  actionArgs: Record<string, unknown>;
  reasoning: string;
  agentEvidence: AgentEvidence;
  probeEvidence: ProbeEvidence;
  toolOutput: { ok: boolean; result: unknown; error?: string };
  finishedAt: string;
}

export interface TrajectoryRecorderOptions {
  v3: V3;
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
  private readonly v3: V3;
  private readonly taskSpec: TaskSpec;
  private readonly runId: string;
  private readonly outputDir: string;
  private readonly persistEnabled: boolean;

  // Events can arrive out-of-order across step indices; same-step events all
  // fire in one microtask.
  private readonly partialSteps = new Map<number, Partial<PartialStep>>();
  private readonly observationByStep = new Map<
    number,
    AgentStepObservedEvent
  >();
  private readonly screenshotsByStep = new Map<
    number,
    AgentScreenshotTakenEvent
  >();
  private finalAnswerEvent?: AgentFinalAnswerEvent;
  private startedAt = "";
  private endedAt = "";
  private listenersAttached = false;

  // Bound handlers so attach/detach refer to the same references.
  private readonly onScreenshot = (e: AgentScreenshotTakenEvent) => {
    this.screenshotsByStep.set(e.stepIndex, e);
    const partial = this.ensurePartial(e.stepIndex);

    // Default to probe when the emit site doesn't tag a role: matches
    // v3AgentHandler's post-step screenshot. For CUA the pre-action shot is
    // NOT a probe — emitCuaActionStep fills that role post-action.
    const role = e.evidenceRole ?? "probe";

    if (role === "probe" || role === "agent_and_probe") {
      const probe: ProbeEvidence = { ...(partial.probeEvidence ?? {}) };
      probe.screenshot = e.screenshot;
      probe.url = e.url;
      partial.probeEvidence = probe;
    } else if (!partial.probeEvidence?.url) {
      // Capture URL even for tier-1-only events; a later post-action URL
      // can still overwrite it.
      partial.probeEvidence = {
        ...(partial.probeEvidence ?? {}),
        url: e.url,
      };
    }

    if (role === "agent" || role === "agent_and_probe") {
      partial.agentEvidence = mergeAgentEvidence(partial.agentEvidence, {
        modalities: [
          { type: "image", bytes: e.screenshot, mediaType: "image/png" },
        ],
      });
    }
  };
  private readonly onStepFinished = (e: AgentStepFinishedEvent) => {
    const partial = this.ensurePartial(e.stepIndex);
    partial.actionName = e.actionName;
    partial.actionArgs = e.actionArgs;
    partial.reasoning = e.reasoning;
    partial.toolOutput = e.toolOutput;
    partial.finishedAt = e.finishedAt;
    partial.agentEvidence = mergeAgentEvidence(
      partial.agentEvidence,
      buildAgentEvidence(e),
    );
  };
  private readonly onStepObserved = (e: AgentStepObservedEvent) => {
    this.observationByStep.set(e.stepIndex, e);
    const partial = this.ensurePartial(e.stepIndex);
    const probe: ProbeEvidence = { ...(partial.probeEvidence ?? {}) };
    probe.url = e.url;
    if (e.ariaTree !== undefined) probe.ariaTree = e.ariaTree;
    if (e.scroll !== undefined) probe.scroll = e.scroll;
    partial.probeEvidence = probe;
  };
  private readonly onFinalAnswer = (e: AgentFinalAnswerEvent) => {
    this.finalAnswerEvent = e;
  };

  constructor(opts: TrajectoryRecorderOptions) {
    this.v3 = opts.v3;
    this.taskSpec = opts.taskSpec;
    this.runId =
      opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
    const root = opts.outputRoot ?? path.join(process.cwd(), ".trajectories");
    this.outputDir = path.join(root, this.runId, opts.taskSpec.id);
    this.persistEnabled = shouldPersistTrajectory(opts.persist);
  }

  /** Subscribe to bus events. Call once before agent.execute(). */
  start(): void {
    if (this.listenersAttached) return;
    this.startedAt = new Date().toISOString();
    this.v3.bus.on("agent_screenshot_taken_event", this.onScreenshot);
    this.v3.bus.on("agent_step_finished_event", this.onStepFinished);
    this.v3.bus.on("agent_step_observed_event", this.onStepObserved);
    this.v3.bus.on("agent_final_answer_event", this.onFinalAnswer);
    this.listenersAttached = true;
  }

  /**
   * Detach listeners, assemble the Trajectory, and (if persistence is on)
   * write the on-disk layout. Idempotent.
   */
  async finish(opts: TrajectoryFinishOptions): Promise<Trajectory> {
    this.detach();
    this.endedAt = new Date().toISOString();

    const steps = this.assembleSteps();
    const trajectory: Trajectory = {
      task: this.taskSpec,
      steps,
      finalAnswer: opts.finalAnswer ?? this.finalAnswerEvent?.message,
      status: opts.status,
      usage: { ...ZERO_USAGE, ...(opts.usage ?? {}) },
      timing: { startedAt: this.startedAt, endedAt: this.endedAt },
    };

    if (this.persistEnabled) {
      await writeTrajectoryDir(this.outputDir, trajectory);
    }

    return trajectory;
  }

  /** Throw away in-memory state without writing to disk. Used on early abort. */
  cancel(): void {
    this.detach();
    this.partialSteps.clear();
    this.observationByStep.clear();
    this.screenshotsByStep.clear();
    this.finalAnswerEvent = undefined;
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
    let taskData: Record<string, unknown> = {};
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

  private detach(): void {
    if (!this.listenersAttached) return;
    this.v3.bus.off("agent_screenshot_taken_event", this.onScreenshot);
    this.v3.bus.off("agent_step_finished_event", this.onStepFinished);
    this.v3.bus.off("agent_step_observed_event", this.onStepObserved);
    this.v3.bus.off("agent_final_answer_event", this.onFinalAnswer);
    this.listenersAttached = false;
  }

  private ensurePartial(stepIndex: number): Partial<PartialStep> {
    let p = this.partialSteps.get(stepIndex);
    if (!p) {
      p = { index: stepIndex };
      this.partialSteps.set(stepIndex, p);
    }
    return p;
  }

  private assembleSteps(): TrajectoryStep[] {
    const out: TrajectoryStep[] = [];
    const indices = [...this.partialSteps.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const p = this.partialSteps.get(i)!;
      if (
        p.actionName === undefined ||
        p.toolOutput === undefined ||
        p.finishedAt === undefined
      ) {
        // CUA emits screenshot-only entries between actions; skip them here
        // and let writeTrajectoryDir record them via the probe channel.
        continue;
      }
      out.push({
        index: i,
        actionName: p.actionName,
        actionArgs: p.actionArgs ?? {},
        reasoning: p.reasoning ?? "",
        agentEvidence: p.agentEvidence ?? { modalities: [] },
        probeEvidence: p.probeEvidence ?? {},
        toolOutput: p.toolOutput,
        startedAt: this.startedAt,
        finishedAt: p.finishedAt,
      });
    }
    return out;
  }
}

function mergeAgentEvidence(
  ...parts: Array<AgentEvidence | undefined>
): AgentEvidence {
  return {
    modalities: parts.flatMap((p) => p?.modalities ?? []),
  };
}

function buildAgentEvidence(e: AgentStepFinishedEvent): AgentEvidence {
  const modalities: AgentEvidence["modalities"] = [];
  if (e.reasoning) {
    modalities.push({ type: "text", content: e.reasoning });
  }
  const result = e.toolOutput.result;
  if (result === undefined || result === null) {
    return { modalities };
  }
  if (typeof result === "string") {
    modalities.push({ type: "text", content: result });
  } else if (Buffer.isBuffer(result)) {
    modalities.push({
      type: "image",
      bytes: result,
      mediaType: "image/png",
    });
  } else if (typeof result === "object") {
    // Vision tools embed a screenshotBase64 alongside the JSON result; lift
    // it to its own image modality so the verifier sees both.
    const r = result as { screenshotBase64?: string } & Record<string, unknown>;
    if (typeof r.screenshotBase64 === "string") {
      try {
        modalities.push({
          type: "image",
          bytes: Buffer.from(r.screenshotBase64, "base64"),
          mediaType: "image/png",
        });
      } catch {
        // Malformed base64; skip the image and keep the JSON modality.
      }
    }
    modalities.push({ type: "json", content: result });
  }
  return { modalities };
}
