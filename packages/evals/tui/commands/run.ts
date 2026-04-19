/**
 * Run command — executes evals with live progress output.
 *
 * Takes a fully-resolved ResolvedRunOptions bundle from parse.ts; does not
 * re-apply precedence. Handles --dry-run (prints a deterministic JSON plan
 * and returns) and scopes env overrides per run so benchmark shorthand
 * values don't leak across REPL commands.
 */

import { bold, dim, cyan, separator } from "../format.js";
import { ProgressRenderer } from "../progress.js";
import { printModelSummary, printResultsTable } from "../results.js";
import {
  discoverTasks,
  resolveTarget,
  runEvals,
} from "../../framework/runner.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import type {
  StartupProfile,
  ToolSurface,
} from "../../core/contracts/tool.js";
import type { ResolvedRunOptions } from "./parse.js";
import { withEnvOverrides } from "./parse.js";
import { getRuntimeTasksRoot } from "../../runtimePaths.js";

type RunProgressEvent = {
  type: "started" | "passed" | "failed" | "error";
  taskName: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
};

export async function runCommand(
  options: ResolvedRunOptions,
  registry?: TaskRegistry,
): Promise<void> {
  const resolvedTasksRoot = getRuntimeTasksRoot();

  if (!registry) {
    registry = await discoverTasks(resolvedTasksRoot, false);
  }

  let tasks: DiscoveredTask[];
  try {
    tasks = resolveTarget(registry, options.normalizedTarget);
  } catch (err) {
    if (options.dryRun) {
      emitDryRun(options, [], (err as Error).message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (options.dryRun) {
    emitDryRun(options, tasks);
    return;
  }

  if (tasks.length === 0) {
    console.log(dim("  No tasks match the given target."));
    return;
  }

  const tierBreakdown = new Map<string, number>();
  for (const t of tasks) {
    tierBreakdown.set(t.tier, (tierBreakdown.get(t.tier) ?? 0) + 1);
  }
  const breakdown = [...tierBreakdown.entries()]
    .map(([tier, count]) => `${count} ${tier}`)
    .join(", ");

  console.log(
    `\n  ${bold("Running:")} ${tasks.length} task(s) ${dim(`(${breakdown})`)}`,
  );
  console.log(
    `  ${bold("Env:")} ${cyan(options.environment)}  ${bold("Trials:")} ${options.trials}  ${bold("Concurrency:")} ${options.concurrency}`,
  );
  console.log(separator());
  console.log("");

  const progress = new ProgressRenderer({ animated: !options.verbose });
  const categoryFilter = deriveCategoryFilter(registry, options.normalizedTarget);

  await withEnvOverrides(options.envOverrides, async () => {
    try {
      const run = async () =>
        runEvals({
          tasks,
          registry,
          concurrency: options.concurrency,
          trials: options.trials,
          environment: options.environment,
          useApi: options.useApi,
          modelOverride: options.model,
          provider: options.provider,
          categoryFilter,
          datasetFilter: options.datasetFilter,
          coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
          coreStartupProfile: options.coreStartupProfile as
            | StartupProfile
            | undefined,
          verbose: options.verbose,
          onProgress: (event: RunProgressEvent) => {
            if (event.type === "started") {
              progress.onStart(event.taskName, event.modelName);
            } else if (event.type === "passed") {
              progress.onPass(event.taskName, event.modelName, event.durationMs);
            } else if (event.type === "failed") {
              progress.onFail(event.taskName, event.modelName, event.error);
            }
          },
        });

      const result = options.verbose
        ? await run()
        : await withSuppressedConsole(run);

      progress.printSummary();

      if (result.results.length > 0 && options.verbose) {
        printResultsTable(result.results);
      } else if (result.results.length > 0) {
        printModelSummary(result.results);
      }

      console.log(dim(`  Experiment: ${result.experimentName}`));
      console.log("");
    } catch (error) {
      progress.dispose();
      throw error;
    }
  });
}

export function deriveCategoryFilter(
  registry: TaskRegistry,
  normalizedTarget?: string,
): string | undefined {
  if (!normalizedTarget) return undefined;
  if (normalizedTarget === "core" || normalizedTarget === "bench") {
    return undefined;
  }
  if (normalizedTarget.includes(":")) {
    return normalizedTarget.split(":", 2)[1];
  }
  if (normalizedTarget.includes("/")) {
    return undefined;
  }
  return registry.byCategory.has(normalizedTarget)
    ? normalizedTarget
    : undefined;
}

/**
 * Emit a deterministic JSON plan for --dry-run. Test-support only — not
 * part of the public CLI contract.
 *
 * Shape is fixed:
 *   { target, normalizedTarget, tasks (sorted), envOverrides (sorted),
 *     runOptions (sorted keys), error? }
 */
function emitDryRun(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  error?: string,
): void {
  const sortedTasks = tasks.map((t) => t.name).sort();

  const envOverrides: Record<string, string> = {};
  for (const key of Object.keys(options.envOverrides).sort()) {
    envOverrides[key] = options.envOverrides[key];
  }

  const runOptions = sortKeys({
    concurrency: options.concurrency,
    coreStartupProfile: options.coreStartupProfile ?? null,
    coreToolSurface: options.coreToolSurface ?? null,
    datasetFilter: options.datasetFilter ?? null,
    environment: options.environment,
    model: options.model ?? null,
    provider: options.provider ?? null,
    trials: options.trials,
    useApi: options.useApi,
    verbose: options.verbose,
  });

  const payload: Record<string, unknown> = {
    target: options.target ?? null,
    normalizedTarget: options.normalizedTarget ?? null,
    tasks: sortedTasks,
    envOverrides,
    runOptions,
  };
  if (error) payload.error = error;

  console.log(JSON.stringify(payload, null, 2));
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted as T;
}

async function withSuppressedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  const noop = (..._args: unknown[]) => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;

  try {
    return await fn();
  } finally {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  }
}
