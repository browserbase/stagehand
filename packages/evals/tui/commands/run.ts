/**
 * Run command — executes evals with live progress output.
 */

import { bold, dim, cyan, red, separator } from "../format.js";
import { ProgressRenderer } from "../progress.js";
import { printResultsTable } from "../results.js";
import { discoverTasks, resolveTarget, runEvals } from "../../framework/runner.js";
import type { TaskRegistry } from "../../framework/types.js";
import { env } from "../../env.js";
import path from "node:path";
import { getPackageRootDir } from "../../runtimePaths.js";

type RunProgressEvent = {
  type: "started" | "passed" | "failed" | "error";
  taskName: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
};

export interface RunCommandOptions {
  target?: string;
  trials?: number;
  concurrency?: number;
  environment?: "LOCAL" | "BROWSERBASE";
  model?: string;
  provider?: string;
  useApi?: boolean;
}

export async function runCommand(
  options: RunCommandOptions,
  registry?: TaskRegistry,
): Promise<void> {
  const resolvedTasksRoot = path.join(getPackageRootDir(), "tasks");

  // Discover tasks if registry not provided
  if (!registry) {
    registry = await discoverTasks(resolvedTasksRoot, false);
  }

  // Resolve target to task list
  let tasks;
  try {
    tasks = resolveTarget(registry, options.target);
  } catch (err) {
    console.error(red(`  ${(err as Error).message}`));
    return;
  }

  if (tasks.length === 0) {
    console.log(dim("  No tasks match the given target."));
    return;
  }

  const environment = options.environment ?? env;
  const tierBreakdown = new Map<string, number>();
  for (const t of tasks) {
    tierBreakdown.set(t.tier, (tierBreakdown.get(t.tier) ?? 0) + 1);
  }
  const breakdown = [...tierBreakdown.entries()]
    .map(([tier, count]) => `${count} ${tier}`)
    .join(", ");

  console.log(`\n  ${bold("Running:")} ${tasks.length} task(s) ${dim(`(${breakdown})`)}`);
  console.log(`  ${bold("Env:")} ${cyan(environment)}  ${bold("Trials:")} ${options.trials ?? 3}  ${bold("Concurrency:")} ${options.concurrency ?? 3}`);
  console.log(separator());
  console.log("");

  const progress = new ProgressRenderer();

  try {
    const result = await runEvals({
      tasks,
      registry,
      concurrency: options.concurrency ?? 3,
      trials: options.trials ?? 3,
      environment,
      useApi: options.useApi,
      modelOverride: options.model,
      categoryFilter: options.target,
      onProgress: (event: RunProgressEvent) => {
        if (event.type === "passed") {
          progress.onPass(event.taskName, event.modelName, event.durationMs);
        } else if (event.type === "failed") {
          progress.onFail(event.taskName, event.modelName, event.error);
        }
      },
    });

    progress.printSummary();

    if (result.results.length > 0) {
      printResultsTable(result.results);
    }

    console.log(dim(`  Experiment: ${result.experimentName}`));
    console.log("");
  } catch (err) {
    console.error(red(`\n  Error: ${(err as Error).message}\n`));
  }
}
