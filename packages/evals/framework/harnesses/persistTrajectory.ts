import fs from "node:fs/promises";
import path from "node:path";
import {
  shouldPersistTrajectory,
  writeTrajectoryDir,
} from "@browserbasehq/stagehand";
import {
  resolveTrajectoryDir,
  writeTrajectoryMetadata,
} from "../trajectoryGroup.js";
import type {
  EvaluationResult,
  TaskSpec,
  Trajectory,
} from "@browserbasehq/stagehand";

export interface PersistAdapterTrajectoryOptions {
  trajectory: Trajectory;
  taskSpec: TaskSpec;
  /** EvaluationResult from V3Evaluator.verify(). Written to scores/result.json. */
  evaluationResult?: EvaluationResult;
  /**
   * Output directory root. Final layout lives at
   * `<outputRoot>/<group>/<task.id>/<runId>/` (group = EVAL_TRAJECTORY_GROUP or "default").
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

/**
 * Persist a trajectory produced by an external-harness adapter (claude_code,
 * codex). External harnesses produce a complete Trajectory synchronously
 * rather than streaming bus events, so they bypass TrajectoryRecorder and
 * call writeTrajectoryDir directly. The evaluationResult, if supplied, is
 * also written under scores/result.json and merged into task_data.json.
 */
export async function persistAdapterTrajectory(
  opts: PersistAdapterTrajectoryOptions,
): Promise<PersistAdapterTrajectoryResult> {
  const runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const root = opts.outputRoot ?? path.join(process.cwd(), ".trajectories");
  const directory = resolveTrajectoryDir(root, opts.taskSpec.id, runId);
  const persisted = shouldPersistTrajectory(opts.persist);

  if (!persisted) {
    return { directory, persisted: false };
  }

  await writeTrajectoryDir(directory, opts.trajectory);
  await writeTrajectoryMetadata(directory, {
    task: opts.taskSpec.id,
    runId,
    status: opts.trajectory.status,
  });

  if (opts.evaluationResult) {
    await fs.writeFile(
      path.join(directory, "scores", "result.json"),
      JSON.stringify(opts.evaluationResult, null, 2),
    );
    await fs.writeFile(
      path.join(directory, "task_data.json"),
      JSON.stringify(
        {
          task: opts.trajectory.task,
          status: opts.trajectory.status,
          finalAnswer: opts.trajectory.finalAnswer ?? null,
          result: opts.evaluationResult,
        },
        null,
        2,
      ),
    );
  }

  return { directory, persisted: true };
}
