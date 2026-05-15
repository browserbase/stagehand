/**
 * TrajectoryRecorder — subscribes to v3.bus step events emitted by the agent
 * handlers (v3AgentHandler / v3CuaAgentHandler) and assembles a Trajectory
 * the verifier can consume.
 *
 * Lifecycle:
 *   const recorder = new TrajectoryRecorder({ v3, taskSpec });
 *   recorder.start();
 *   await agent.execute(...);
 *   const trajectory = await recorder.finish({ status: "complete", usage });
 *
 * Persistence is env-gated by `VERIFIER_PERSIST_TRAJECTORIES` (plan §10 Q2):
 *   - unset: persistence follows the default (on locally, off in CI).
 *   - "1" / "true": always persist.
 *   - "0" / "false": never persist.
 *
 * On-disk layout is stable JSON + screenshots so saved runs can be re-scored
 * without format conversion.
 *
 * @see ~/.claude/plans/verifier-rewrite.html §06 (Trajectory on-disk)
 */
import fs from "node:fs/promises";
import path from "node:path";
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
  Verdict,
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

/**
 * Decide whether to persist by default. Honors the explicit override first,
 * then env, then falls back to "persist when not in CI".
 */
function shouldPersist(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  const env = process.env.VERIFIER_PERSIST_TRAJECTORIES?.toLowerCase();
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return !process.env.CI;
}

export class TrajectoryRecorder {
  private readonly v3: V3;
  private readonly taskSpec: TaskSpec;
  private readonly runId: string;
  private readonly outputDir: string;
  private readonly persistEnabled: boolean;

  // Per-stepIndex builders; events can arrive out-of-order in theory, though
  // the handlers emit step_finished → screenshot_taken → step_observed in the
  // same microtask.
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

  // Strongly-typed bound handlers so we can attach/detach the same references.
  private readonly onScreenshot = (e: AgentScreenshotTakenEvent) => {
    this.screenshotsByStep.set(e.stepIndex, e);
    const partial = this.ensurePartial(e.stepIndex);

    // Default to "probe" when the emit site doesn't tag the role — matches
    // v3AgentHandler's post-step screenshot, which is always a tier-2 probe.
    const role = e.evidenceRole ?? "probe";

    // Probe channel (tier 2): the page's state at observation time. For CUA
    // the pre-action screenshot is NOT a probe — that role is filled by the
    // post-action emit from emitCuaActionStep. So only update probe.screenshot
    // when the event explicitly carries the probe role.
    if (role === "probe" || role === "agent_and_probe") {
      const probe: ProbeEvidence = { ...(partial.probeEvidence ?? {}) };
      probe.screenshot = e.screenshot;
      probe.url = e.url;
      partial.probeEvidence = probe;
    } else if (!partial.probeEvidence?.url) {
      // Even for tier-1-only events, the URL is useful probe context if we
      // don't have one yet. Doesn't overwrite a later post-action URL.
      partial.probeEvidence = {
        ...(partial.probeEvidence ?? {}),
        url: e.url,
      };
    }

    // Agent channel (tier 1): bytes the model ingested.
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
      opts.runId ??
      new Date().toISOString().replace(/[:.]/g, "-").replace("T", "T");
    const root = opts.outputRoot ?? path.join(process.cwd(), ".trajectories");
    this.outputDir = path.join(root, this.runId, opts.taskSpec.id);
    this.persistEnabled = shouldPersist(opts.persist);
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
      await this.persist(trajectory);
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
   * Persist verifier scores next to the trajectory. No-op when trajectory
   * persistence is disabled.
   */
  async persistVerdict(
    verdict: Verdict,
    filename = "mmrubric_v1.json",
  ): Promise<void> {
    if (!this.persistEnabled) return;

    const scoresDir = path.join(this.outputDir, "scores");
    await fs.mkdir(scoresDir, { recursive: true });
    await fs.writeFile(
      path.join(scoresDir, filename),
      JSON.stringify(verdict, null, 2),
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
      JSON.stringify({ ...taskData, verdict }, null, 2),
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

  /**
   * Materialize ordered TrajectoryStep[] from the accumulated partials.
   * Steps that never received a step_finished event are skipped (they can
   * appear for CUA where only screenshot events fire — those are recorded as
   * orphan probe screenshots and elided here).
   */
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
        // Orphan screenshot-only entry (typically CUA). Skip — we record
        // these by writing the screenshot to disk separately during persist().
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

  /**
   * Write the trajectory directory layout.
   *
   *   <outputDir>/
   *     ├── task_data.json
   *     ├── trajectory.json    (screenshots referenced by path)
   *     ├── screenshots/
   *     │   ├── probe/<N>.png
   *     │   └── agent/<N>.png
   *     └── times.json
   */
  private async persist(trajectory: Trajectory): Promise<void> {
    await fs.mkdir(this.outputDir, { recursive: true });

    // Walk steps and write screenshots; replace Buffer with path reference in
    // the serialized trajectory. Both tiers externalize image bytes under
    //   screenshots/probe/<N>.png   — tier 2, what the harness observed
    //   screenshots/agent/<N>.png   — tier 1, what the model received
    // The `_<j>` suffix only appears when a step carries multiple images
    // (rare; typically zero or one per step). Paths in JSON are relative to
    // the trajectory dir so the directory is movable/copyable as a unit.
    await fs.mkdir(path.join(this.outputDir, "screenshots", "probe"), {
      recursive: true,
    });
    await fs.mkdir(path.join(this.outputDir, "screenshots", "agent"), {
      recursive: true,
    });

    const serializableSteps: unknown[] = [];
    for (const step of trajectory.steps) {
      const probe: ProbeEvidence = { ...step.probeEvidence };
      if (probe.screenshot) {
        const relPath = `screenshots/probe/${step.index + 1}.png`;
        await fs.writeFile(
          path.join(this.outputDir, relPath),
          probe.screenshot,
        );
        probe.screenshotPath = relPath;
        delete probe.screenshot;
      }

      const imageModalities = step.agentEvidence.modalities.filter(
        (m) => m.type === "image",
      );
      const multipleImages = imageModalities.length > 1;
      let imageSeq = 0;
      const modalities: unknown[] = [];
      for (const m of step.agentEvidence.modalities) {
        if (m.type !== "image") {
          modalities.push(m);
          continue;
        }
        const suffix = multipleImages ? `_${imageSeq}` : "";
        const relPath = `screenshots/agent/${step.index + 1}${suffix}.png`;
        await fs.writeFile(path.join(this.outputDir, relPath), m.bytes);
        modalities.push({
          type: "image",
          imagePath: relPath,
          mediaType: m.mediaType,
        });
        imageSeq += 1;
      }
      const agentEvidence = { modalities };
      serializableSteps.push({ ...step, probeEvidence: probe, agentEvidence });
    }

    // Image modalities carry imagePath instead of raw bytes on disk, so this
    // is no longer a strict Trajectory at the type level. Cast through
    // unknown rather than widening the type contract.
    const serialized = {
      ...trajectory,
      steps: serializableSteps,
    } as unknown;

    await fs.writeFile(
      path.join(this.outputDir, "trajectory.json"),
      JSON.stringify(serialized, null, 2),
    );

    // task_data.json stores TaskSpec + (later) verdict.
    await fs.writeFile(
      path.join(this.outputDir, "task_data.json"),
      JSON.stringify(
        {
          task: trajectory.task,
          status: trajectory.status,
          finalAnswer: trajectory.finalAnswer ?? null,
        },
        null,
        2,
      ),
    );

    await fs.writeFile(
      path.join(this.outputDir, "times.json"),
      JSON.stringify(
        {
          timing: trajectory.timing,
          usage: trajectory.usage,
          stepCount: trajectory.steps.length,
        },
        null,
        2,
      ),
    );

    await fs.mkdir(path.join(this.outputDir, "scores"), { recursive: true });
    await fs.writeFile(
      path.join(this.outputDir, "core.log"),
      coreLog(trajectory),
    );
  }
}

function mergeAgentEvidence(
  ...parts: Array<AgentEvidence | undefined>
): AgentEvidence {
  return {
    modalities: parts.flatMap((p) => p?.modalities ?? []),
  };
}

/**
 * Build a tier-1 AgentEvidence from a step_finished event. The handler's
 * toolOutput.result is what the LLM consumed next turn (modulo SDK
 * serialization). Wave 1 will replace this with a higher-fidelity capture
 * pulled from event.response.messages.
 */
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
    // Tool results commonly include a screenshotBase64 field for vision tools.
    const r = result as { screenshotBase64?: string } & Record<string, unknown>;
    if (typeof r.screenshotBase64 === "string") {
      try {
        modalities.push({
          type: "image",
          bytes: Buffer.from(r.screenshotBase64, "base64"),
          mediaType: "image/png",
        });
      } catch {
        // ignore
      }
    }
    modalities.push({ type: "json", content: result });
  }
  return { modalities };
}

function coreLog(trajectory: Trajectory): string {
  return (
    trajectory.steps
      .map((step) =>
        JSON.stringify({
          step: step.index,
          action: step.actionName,
          url: step.probeEvidence.url ?? null,
          ok: step.toolOutput.ok,
          reasoning: step.reasoning || undefined,
          startedAt: step.startedAt,
          finishedAt: step.finishedAt,
        }),
      )
      .join("\n") + "\n"
  );
}
