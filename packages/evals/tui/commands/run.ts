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
import { discoverTasks, resolveTarget } from "../../framework/discovery.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import {
  buildBenchMatrixRow,
  generateBenchTestcases,
} from "../../framework/benchPlanner.js";
import type { StartupProfile, ToolSurface } from "../../core/contracts/tool.js";
import type { AvailableModel } from "@browserbasehq/stagehand";
import type { ResolvedRunOptions } from "./parse.js";
import { withEnvOverrides } from "./parse.js";
import { getRuntimeTasksRoot } from "../../runtimePaths.js";
import {
  isExecutableBenchHarness,
  type Harness,
} from "../../framework/benchTypes.js";

type RunProgressEvent = {
  type: "started" | "passed" | "failed" | "error";
  taskName: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
};

const LEGACY_ONLY_BENCHMARK_TARGETS = new Set(["agent/gaia"]);

function isExplicitLegacyOnlyTarget(target?: string): boolean {
  return Boolean(target && LEGACY_ONLY_BENCHMARK_TARGETS.has(target));
}

function splitLegacyOnlyTasks(tasks: DiscoveredTask[]): {
  runnableTasks: DiscoveredTask[];
  skippedTasks: DiscoveredTask[];
} {
  const runnableTasks: DiscoveredTask[] = [];
  const skippedTasks: DiscoveredTask[] = [];

  for (const task of tasks) {
    if (LEGACY_ONLY_BENCHMARK_TARGETS.has(task.name)) {
      skippedTasks.push(task);
    } else {
      runnableTasks.push(task);
    }
  }

  return { runnableTasks, skippedTasks };
}

export async function runCommand(
  options: ResolvedRunOptions,
  registry?: TaskRegistry,
  signal?: AbortSignal,
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
      await emitDryRun(options, [], registry, (err as Error).message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (isExplicitLegacyOnlyTarget(options.normalizedTarget)) {
    const message = `Benchmark "${options.normalizedTarget}" is legacy-only. Use --legacy or choose b:webvoyager / b:onlineMind2Web / b:webtailbench.`;
    if (options.dryRun) {
      await emitDryRun(options, tasks, registry, message);
      process.exitCode = 1;
      return;
    }
    throw new Error(message);
  }

  const { runnableTasks, skippedTasks } = splitLegacyOnlyTasks(tasks);
  tasks = runnableTasks;

  if (tasks.length === 0) {
    const message = options.normalizedTarget
      ? `No runnable tasks found matching "${options.normalizedTarget}".`
      : "No runnable tasks found.";
    if (options.dryRun) {
      await emitDryRun(options, tasks, registry, message, skippedTasks);
      process.exitCode = 1;
      return;
    }
    throw new Error(message);
  }

  if (
    options.useApi &&
    options.harness !== "stagehand" &&
    tasks.some((t) => t.tier === "bench")
  ) {
    throw new Error(
      `Harness "${options.harness}" does not support --api. Use --harness stagehand for API-backed bench runs.`,
    );
  }

  if (options.dryRun) {
    await emitDryRun(options, tasks, registry, undefined, skippedTasks);
    return;
  }

  if (
    !canExecuteBenchHarness(options.harness) &&
    tasks.some((t) => t.tier === "bench")
  ) {
    throw new Error(
      `Harness "${options.harness}" is dry-run only for now. Use --harness stagehand or --harness claude_code for executable bench runs.`,
    );
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
  if (skippedTasks.length > 0) {
    console.log(
      `  ${bold("Skipped:")} ${skippedTasks.length} legacy-only task(s) ${dim(skippedTasks.map((task) => task.name).join(", "))}`,
    );
  }
  console.log(
    `  ${bold("Env:")} ${cyan(options.environment)}  ${bold("Trials:")} ${options.trials}  ${bold("Concurrency:")} ${options.concurrency}`,
  );
  console.log(separator());
  console.log("");

  const progress = new ProgressRenderer({ animated: !options.verbose });
  const categoryFilter = deriveCategoryFilter(
    registry,
    options.normalizedTarget,
  );

  await withEnvOverrides(options.envOverrides, async () => {
    try {
      const { runEvals } = await import("../../framework/runner.js");
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
          agentMode: options.agentMode,
          agentModes: options.agentModes,
          harness: options.harness,
          categoryFilter,
          datasetFilter: options.datasetFilter,
          coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
          coreStartupProfile: options.coreStartupProfile as
            | StartupProfile
            | undefined,
          verbose: options.verbose,
          signal,
          onProgress: (event: RunProgressEvent) => {
            if (event.type === "started") {
              progress.onStart(event.taskName, event.modelName);
            } else if (event.type === "passed") {
              progress.onPass(
                event.taskName,
                event.modelName,
                event.durationMs,
              );
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

export function canExecuteBenchHarness(harness: Harness): boolean {
  return isExecutableBenchHarness(harness);
}

/**
 * Emit a deterministic JSON plan for --dry-run. Test-support only — not
 * part of the public CLI contract.
 *
 * Shape is fixed:
 *   { target, normalizedTarget, tasks (sorted), envOverrides (sorted),
 *     runOptions (sorted keys), error? }
 */
async function emitDryRun(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  registry: TaskRegistry,
  error?: string,
  skippedTasks: DiscoveredTask[] = [],
): Promise<void> {
  const sortedTasks = tasks.map((t) => t.name).sort();
  const sortedSkippedTasks = skippedTasks.map((t) => t.name).sort();

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
    harness: options.harness,
    agentMode: options.agentMode ?? null,
    agentModes: options.agentModes ?? null,
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
    skippedTasks: sortedSkippedTasks,
    envOverrides,
    runOptions,
    matrix: error ? [] : await buildDryRunMatrix(options, tasks, registry),
  };
  if (error) payload.error = error;

  console.log(JSON.stringify(payload, null, 2));
}

async function buildDryRunMatrix(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  registry: TaskRegistry,
): Promise<Array<Record<string, unknown>>> {
  return withEnvOverrides(options.envOverrides, async () => {
    const rows: Array<Record<string, unknown>> = [];

    for (const task of tasks.filter((t) => t.tier === "core")) {
      rows.push(
        sortKeys({
          tier: "core",
          task: task.name,
          category: task.primaryCategory,
          model: "none",
          environment: options.environment,
        }),
      );
    }

    const benchTasks = tasks.filter((t) => t.tier === "bench");
    if (benchTasks.length > 0) {
      const categoryFilter = deriveCategoryFilter(
        registry,
        options.normalizedTarget,
      );
      const testcases = generateBenchTestcases(benchTasks, {
        environment: options.environment,
        useApi: options.useApi,
        modelOverride: options.model,
        provider: options.provider,
        harness: options.harness,
        categoryFilter,
        datasetFilter: options.datasetFilter,
        agentMode: options.agentMode,
        agentModes: options.agentModes,
        coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
        coreStartupProfile: options.coreStartupProfile as
          | StartupProfile
          | undefined,
      });

      for (const testcase of testcases) {
        const task =
          registry.byName.get(testcase.input.name) ??
          (testcase.input.name.includes("/")
            ? undefined
            : registry.byName.get(`agent/${testcase.input.name}`));
        const row = task
          ? buildBenchMatrixRow(
              task,
              testcase.input.modelName,
              {
                ...options,
                coreToolSurface: options.coreToolSurface as
                  | ToolSurface
                  | undefined,
                coreStartupProfile: options.coreStartupProfile as
                  | StartupProfile
                  | undefined,
              },
              testcase.input.params,
              testcase.input.isCUA,
              testcase.input.agentMode,
            )
          : undefined;
        rows.push(
          sortKeys({
            tier: testcase.metadata.tier ?? "bench",
            task: testcase.metadata.task ?? testcase.input.name,
            category:
              testcase.metadata.task_category ??
              testcase.metadata.category ??
              null,
            dataset: testcase.metadata.dataset ?? null,
            model: testcase.input.modelName as AvailableModel,
            harness: testcase.metadata.harness ?? options.harness,
            agentMode: testcase.input.agentMode ?? null,
            environment: testcase.metadata.environment ?? options.environment,
            useApi: testcase.metadata.api ?? options.useApi,
            provider: testcase.metadata.provider ?? options.provider ?? null,
            toolSurface: testcase.metadata.toolSurface ?? null,
            startupProfile: testcase.metadata.startupProfile ?? null,
            toolCommand: testcase.metadata.toolCommand ?? null,
            browseCliVersion: testcase.metadata.browseCliVersion ?? null,
            browseCliEntrypoint: testcase.metadata.browseCliEntrypoint ?? null,
            harnessConfig: row?.config ?? null,
          }),
        );
      }
    }

    return rows;
  });
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

  const noop = () => {};
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
