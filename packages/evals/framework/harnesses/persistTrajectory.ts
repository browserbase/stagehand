import fs from "node:fs/promises";
import path from "node:path";
import { shouldPersistTrajectory, writeTrajectoryDir } from "stagehand-v3";
import {
  reserveTrajectoryDir,
  resolveTrajectoryDir,
  resolveTrajectoryRoot,
  writeTrajectoryMetadata,
} from "../trajectoryGroup.js";
import type { EvaluationResult, TaskSpec } from "stagehand-v3";
import type { HarnessTrajectory } from "./trajectoryAdapter.js";
import type { UngradedVerifierResult } from "../verifierAdapter.js";

export interface PersistAdapterTrajectoryOptions {
  trajectory: HarnessTrajectory;
  taskSpec: TaskSpec;
  evaluationResult?: EvaluationResult | UngradedVerifierResult;
  outputRoot?: string;
  runId?: string;
  persist?: boolean;
}

export interface PersistAdapterTrajectoryResult {
  directory: string;
  persisted: boolean;
}

export async function persistAdapterTrajectory(
  opts: PersistAdapterTrajectoryOptions,
): Promise<PersistAdapterTrajectoryResult> {
  const runId = opts.runId ?? new Date().toISOString().replace(/[:.]/g, "-");
  const root = opts.outputRoot ?? resolveTrajectoryRoot();
  const persisted = shouldPersistTrajectory(opts.persist);

  if (!persisted) {
    return {
      directory: resolveTrajectoryDir(root, opts.taskSpec.id, runId),
      persisted: false,
    };
  }

  const { directory, attempt } = await reserveTrajectoryDir(root, opts.taskSpec.id, runId);

  await writeTrajectoryDir(directory, opts.trajectory);
  await writeTrajectoryMetadata(directory, {
    task: opts.taskSpec.id,
    runId,
    runDir: path.basename(directory),
    attempt,
    status: opts.trajectory.status,
    ...(opts.trajectory.cost_pricing && { cost_pricing: opts.trajectory.cost_pricing }),
    ...(opts.trajectory.terminationReason && {
      terminationReason: opts.trajectory.terminationReason,
    }),
    ...(opts.trajectory.harnessImplementation && {
      harnessImplementation: opts.trajectory.harnessImplementation,
    }),
    ...(opts.trajectory.harnessConfiguration && {
      harnessConfiguration: opts.trajectory.harnessConfiguration,
    }),
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
          ...(opts.trajectory.cost_pricing && { cost_pricing: opts.trajectory.cost_pricing }),
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
