/**
 * persistAdapterTrajectory — writes the on-disk layout used by the Stagehand
 * `TrajectoryRecorder.persist()` for trajectories built by external-harness
 * adapters (claude_code, codex).
 *
 * `TrajectoryRecorder` itself is coupled to v3.bus events: it subscribes
 * during the agent run, accumulates partial steps, and emits the final
 * trajectory on finish(). External harnesses don't go through that bus —
 * they produce a complete `Trajectory` synchronously after the harness
 * finishes — so this helper writes the same on-disk layout without the
 * event-subscription lifecycle.
 *
 * The on-disk layout matches TrajectoryRecorder.persist():
 *
 *   <dir>/
 *     ├── task_data.json
 *     ├── trajectory.json   (images referenced by path)
 *     ├── screenshots/
 *     │   ├── probe/<N>.png
 *     │   └── agent/<N>.png
 *     ├── scores/
 *     │   └── result.json       (if `evaluationResult` passed)
 *     ├── core.log
 *     └── times.json
 *
 * Honors `VERIFIER_PERSIST_TRAJECTORIES` for default on/off (matches
 * TrajectoryRecorder's convention):
 *   - "1" / "true": always persist.
 *   - "0" / "false": never persist.
 *   - unset: persists when not in CI.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  EvaluationResult,
  ProbeEvidence,
  TaskSpec,
  Trajectory,
} from "@browserbasehq/stagehand";

export interface PersistAdapterTrajectoryOptions {
  trajectory: Trajectory;
  taskSpec: TaskSpec;
  /** EvaluationResult from V3Evaluator.verify(). Written to scores/result.json. */
  evaluationResult?: EvaluationResult;
  /**
   * Output directory root. Final layout lives at `<outputRoot>/<runId>/<task.id>/`.
   * Defaults to `<cwd>/.trajectories`.
   */
  outputRoot?: string;
  /** Run identifier (e.g., ISO timestamp). Defaults to a fresh timestamp. */
  runId?: string;
  /**
   * Override the env-gated persistence default. `true` always persists,
   * `false` never does, `undefined` defers to VERIFIER_PERSIST_TRAJECTORIES.
   */
  persist?: boolean;
}

export interface PersistAdapterTrajectoryResult {
  /** The directory the trajectory was (or would have been) persisted to. */
  directory: string;
  /** Whether persistence actually wrote files. */
  persisted: boolean;
}

function shouldPersist(override: boolean | undefined): boolean {
  if (override !== undefined) return override;
  const env = process.env.VERIFIER_PERSIST_TRAJECTORIES?.toLowerCase();
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return !process.env.CI;
}

export async function persistAdapterTrajectory(
  opts: PersistAdapterTrajectoryOptions,
): Promise<PersistAdapterTrajectoryResult> {
  const runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const root = opts.outputRoot ?? path.join(process.cwd(), ".trajectories");
  const directory = path.join(root, runId, opts.taskSpec.id);
  const persisted = shouldPersist(opts.persist);

  if (!persisted) {
    return { directory, persisted: false };
  }

  await fs.mkdir(directory, { recursive: true });
  await fs.mkdir(path.join(directory, "screenshots", "probe"), {
    recursive: true,
  });
  await fs.mkdir(path.join(directory, "screenshots", "agent"), {
    recursive: true,
  });

  // Walk steps and write image bytes to disk, replacing in-memory Buffers with
  // path references in trajectory.json.
  const serializableSteps: unknown[] = [];
  for (const step of opts.trajectory.steps) {
    const probe: ProbeEvidence = { ...step.probeEvidence };
    if (probe.screenshot) {
      const relPath = `screenshots/probe/${step.index + 1}.png`;
      await fs.writeFile(path.join(directory, relPath), probe.screenshot);
      probe.screenshotPath = relPath;
      delete probe.screenshot;
    }

    const imageModalities = step.agentEvidence.modalities.filter(
      (m) => m.type === "image",
    );
    const multipleImages = imageModalities.length > 1;
    let imageSeq = 0;
    const agentEvidence = {
      modalities: await Promise.all(
        step.agentEvidence.modalities.map(async (m) => {
          if (m.type !== "image") return m;
          const suffix = multipleImages ? `_${imageSeq}` : "";
          const relPath = `screenshots/agent/${step.index + 1}${suffix}.png`;
          imageSeq += 1;
          await fs.writeFile(path.join(directory, relPath), m.bytes);
          return {
            type: "image" as const,
            imagePath: relPath,
            mediaType: m.mediaType,
          };
        }),
      ),
    };
    serializableSteps.push({ ...step, probeEvidence: probe, agentEvidence });
  }

  const serialized = {
    ...opts.trajectory,
    steps: serializableSteps,
  } as unknown;

  await fs.writeFile(
    path.join(directory, "trajectory.json"),
    JSON.stringify(serialized, null, 2),
  );

  const taskData: Record<string, unknown> = {
    task: opts.trajectory.task,
    status: opts.trajectory.status,
    finalAnswer: opts.trajectory.finalAnswer ?? null,
  };
  if (opts.evaluationResult) {
    taskData.result = opts.evaluationResult;
  }
  await fs.writeFile(
    path.join(directory, "task_data.json"),
    JSON.stringify(taskData, null, 2),
  );

  await fs.writeFile(
    path.join(directory, "times.json"),
    JSON.stringify(
      {
        timing: opts.trajectory.timing,
        usage: opts.trajectory.usage,
        stepCount: opts.trajectory.steps.length,
      },
      null,
      2,
    ),
  );

  await fs.mkdir(path.join(directory, "scores"), { recursive: true });
  if (opts.evaluationResult) {
    await fs.writeFile(
      path.join(directory, "scores", "result.json"),
      JSON.stringify(opts.evaluationResult, null, 2),
    );
  }

  await fs.writeFile(
    path.join(directory, "core.log"),
    coreLog(opts.trajectory),
  );

  return { directory, persisted: true };
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
