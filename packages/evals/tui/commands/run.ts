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
import { renderPreview } from "../preview.js";
import { discoverTasks, resolveTarget } from "../../framework/discovery.js";
import type { DiscoveredTask, TaskRegistry } from "../../framework/types.js";
import { buildBenchMatrixRow, generateBenchTestcases } from "../../framework/benchPlanner.js";
import type { StartupProfile, ToolSurface } from "../../core/contracts/tool.js";
import type { AvailableModel } from "stagehand-v3";
import type { ResolvedRunOptions } from "./parse.js";
import { withEnvOverrides } from "./parse.js";
import { getRuntimeTasksRoot } from "../../runtimePaths.js";
import type { Harness } from "../../framework/benchTypes.js";
import { formatBenchHarnessFlags, isExecutableBenchHarness } from "../../framework/benchHarness.js";
import {
  armsOverLimit,
  armsWithUngradedRuns,
  resolveUnverifiableCriteriaLimit,
  summarizeArmVerifiability,
} from "../../framework/verifierGate.js";

type RunProgressEvent = {
  type: "planned" | "started" | "passed" | "failed" | "error";
  taskName?: string;
  modelName?: string;
  durationMs?: number;
  error?: string;
  total?: number;
};

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function uniqueStringValues(
  rows: Array<Record<string, unknown>>,
  key: string,
  options: { exclude?: readonly string[]; requireTruthy?: boolean } = {},
): string[] {
  const excluded = new Set(options.exclude ?? []);
  const values = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const str = String(value);
    if (options.requireTruthy && !str) continue;
    if (excluded.has(str)) continue;
    values.add(str);
  }
  return [...values];
}

function buildRunTargetLabel(options: ResolvedRunOptions): string {
  return options.target ?? options.normalizedTarget ?? "bench";
}

function buildPlanLine(
  options: ResolvedRunOptions,
  matrix: Array<Record<string, unknown>>,
): string {
  const matrixRows = matrix.length;
  const trials = options.trials;
  const taskCount = uniqueStringValues(matrix, "task").length;
  const modelCount = uniqueStringValues(matrix, "model", {
    exclude: ["none"],
  }).length;
  const harnessCount = uniqueStringValues(matrix, "harness").length;
  const toolSurfaceCount = uniqueStringValues(matrix, "toolSurface", {
    requireTruthy: true,
  }).length;
  const nonBaseFactors = [
    modelCount === 0 ? 1 : modelCount,
    harnessCount > 1 ? harnessCount : 1,
    toolSurfaceCount > 1 ? toolSurfaceCount : 1,
  ];
  const nonBaseProduct = nonBaseFactors.reduce((product, value) => product * value, 1);
  const canFactorCleanly = nonBaseProduct > 0 && matrixRows % nonBaseProduct === 0;
  const baseCount = canFactorCleanly ? matrixRows / nonBaseProduct : matrixRows;
  const hasDatasetCases =
    uniqueStringValues(matrix, "dataset", {
      requireTruthy: true,
    }).length > 0;
  const baseLabel =
    hasDatasetCases || !canFactorCleanly || baseCount !== taskCount ? "case" : "task";

  const factors = [formatCount(baseCount, baseLabel)];
  if (canFactorCleanly) {
    if (modelCount > 0) {
      factors.push(formatCount(modelCount, "model"));
    }
    if (harnessCount > 1) factors.push(formatCount(harnessCount, "harness"));
    if (toolSurfaceCount > 1) {
      factors.push(formatCount(toolSurfaceCount, "tool surface"));
    }
  }
  factors.push(formatCount(trials, "trial"));

  const runs = matrixRows * trials;
  return `${factors.join(" × ")} = ${formatCount(runs, "run")}`;
}

function buildRunContextLine(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  matrix: Array<Record<string, unknown>>,
): string {
  const parts = [`${bold("Env:")} ${cyan(options.environment)}`];
  if (tasks.some((task) => task.tier === "bench")) {
    parts.push(`${bold("Harness:")} ${options.harness}`);
  }

  const toolSurfaces = uniqueStringValues(matrix, "toolSurface", {
    requireTruthy: true,
  });
  if (toolSurfaces.length === 1) {
    parts.push(`${bold("Tool:")} ${toolSurfaces[0]}`);
  }

  parts.push(`${bold("Concurrency:")} ${options.concurrency}`);
  return parts.join("  ");
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

  const planMode = options.dryRun || options.preview;

  let tasks: DiscoveredTask[];
  try {
    tasks = resolveTarget(registry, options.normalizedTarget);
  } catch (err) {
    if (planMode) {
      await emitDryRun(options, [], registry, (err as Error).message);
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (tasks.length === 0) {
    const message = options.normalizedTarget
      ? `No runnable tasks found matching "${options.normalizedTarget}".`
      : "No runnable tasks found.";
    if (planMode) {
      await emitDryRun(options, tasks, registry, message);
      process.exitCode = 1;
      return;
    }
    throw new Error(message);
  }

  const hasCoreOnly = tasks.every((task) => task.tier === "core");
  if (hasCoreOnly) {
    const { rejectAgentMountOnlyCoreTool } = await import("../../framework/context.js");
    rejectAgentMountOnlyCoreTool((options.coreToolSurface ?? "understudy_code") as ToolSurface);
  }

  if (options.useApi && options.harness !== "stagehand" && tasks.some((t) => t.tier === "bench")) {
    throw new Error(
      `Harness "${options.harness}" does not support --api. Use --harness stagehand for API-backed bench runs.`,
    );
  }

  if (planMode) {
    await emitDryRun(options, tasks, registry);
    return;
  }

  if (!canExecuteBenchHarness(options.harness) && tasks.some((t) => t.tier === "bench")) {
    throw new Error(
      `Harness "${options.harness}" is dry-run only for now. Use ${formatBenchHarnessFlags()} for executable bench runs.`,
    );
  }
  const matrix = await buildDryRunMatrix(options, tasks, registry);

  console.log(`\n  ${bold("Running:")} ${cyan(buildRunTargetLabel(options))}`);
  console.log(`  ${bold("Plan:")} ${buildPlanLine(options, matrix)}`);
  console.log(`  ${buildRunContextLine(options, tasks, matrix)}`);
  console.log(separator());
  console.log("");

  const progress = new ProgressRenderer({
    animated: !options.verbose,
    progressBar: options.verbose,
  });
  const categoryFilter = deriveCategoryFilter(registry, options.normalizedTarget);

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
          harness: options.harness,
          categoryFilter,
          datasetFilter: options.datasetFilter,
          coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
          coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
          verbose: options.verbose,
          signal,
          onProgress: (event: RunProgressEvent) => {
            if (event.type === "planned") {
              progress.onPlanned(event.total ?? 0);
            } else if (event.type === "started" && event.taskName) {
              progress.onStart(event.taskName, event.modelName);
            } else if (event.type === "passed" && event.taskName) {
              progress.onPass(event.taskName, event.modelName, event.durationMs);
            } else if (event.type === "failed" && event.taskName) {
              progress.onFail(event.taskName, event.modelName, event.error);
            }
          },
        });

      const result = options.verbose ? await run() : await withSuppressedConsole(run);

      progress.printSummary();

      if (result.results.length > 0 && options.verbose) {
        printResultsTable(result.results);
      } else if (result.results.length > 0) {
        printModelSummary(result.results);
      }

      const arms = summarizeArmVerifiability(result.results, options.harness);
      const unverifiableLimit = resolveUnverifiableCriteriaLimit();
      if (arms.length > 0) {
        for (const arm of arms) {
          const ungradedSuffix =
            arm.ungradedRuns > 0 ? `, ${arm.ungradedRuns} ungraded (self-reported)` : "";
          console.log(
            dim(
              `  Verifiability: ${arm.arm} — ${arm.unverifiableCriteria}/${arm.totalCriteria} criteria unverifiable across ${arm.gradedRuns} graded runs${ungradedSuffix}`,
            ),
          );
        }
        if (unverifiableLimit !== undefined) {
          const over = armsOverLimit(arms, unverifiableLimit);
          for (const arm of over) {
            console.error(
              `  ✗ verifiability gate: ${arm.arm} has ${arm.unverifiableCriteria} unverifiable criteria (limit ${unverifiableLimit})`,
            );
          }
          // A gated batch must never publish self-reported rows as passes:
          // any verifier failure fails the batch, whatever the criteria count.
          const ungraded = armsWithUngradedRuns(arms);
          for (const arm of ungraded) {
            console.error(
              `  ✗ verifiability gate: ${arm.arm} has ${arm.ungradedRuns} ungraded (self-reported) runs`,
            );
          }
          if (over.length > 0 || ungraded.length > 0) {
            process.exitCode = 1;
          }
        }
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
  return registry.byCategory.has(normalizedTarget) ? normalizedTarget : undefined;
}

export function canExecuteBenchHarness(harness: Harness): boolean {
  return isExecutableBenchHarness(harness);
}

/**
 * Build the deterministic plan payload and render it.
 *
 * Mode is chosen by ResolvedRunOptions.preview:
 *   - false (default, --dry-run) → JSON.stringify to stdout. Shape is fixed:
 *     { target, normalizedTarget, tasks (sorted), envOverrides (sorted),
 *       runOptions (sorted keys), matrix, error? }. Test-support only —
 *     not part of the public CLI contract.
 *   - true (--preview) → renderPreview prints a human-readable table.
 *
 * The payload built here is the single source of truth for both renderers.
 */
async function emitDryRun(
  options: ResolvedRunOptions,
  tasks: DiscoveredTask[],
  registry: TaskRegistry,
  error?: string,
): Promise<void> {
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
    harness: options.harness,
    model: options.model ?? null,
    trials: options.trials,
    useApi: options.useApi,
    verbose: options.verbose,
  });

  let matrix: Array<Record<string, unknown>> = [];
  let planError = error;
  if (!planError) {
    try {
      matrix = await buildDryRunMatrix(options, tasks, registry);
    } catch (matrixError) {
      planError = matrixError instanceof Error ? matrixError.message : String(matrixError);
      process.exitCode = 1;
    }
  }

  const payload: Record<string, unknown> = {
    target: options.target ?? null,
    normalizedTarget: options.normalizedTarget ?? null,
    tasks: sortedTasks,
    envOverrides,
    runOptions,
    matrix,
  };
  if (planError) payload.error = planError;

  if (options.preview) {
    renderPreview(payload);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
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
      const categoryFilter = deriveCategoryFilter(registry, options.normalizedTarget);
      const testcases = generateBenchTestcases(benchTasks, {
        environment: options.environment,
        useApi: options.useApi,
        modelOverride: options.model,
        harness: options.harness,
        categoryFilter,
        datasetFilter: options.datasetFilter,
        coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
        coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
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
                coreToolSurface: options.coreToolSurface as ToolSurface | undefined,
                coreStartupProfile: options.coreStartupProfile as StartupProfile | undefined,
              },
              testcase.input.params,
            )
          : undefined;
        rows.push(
          sortKeys({
            tier: testcase.metadata.tier ?? "bench",
            task: testcase.metadata.task ?? testcase.input.name,
            category: testcase.metadata.task_category ?? testcase.metadata.category ?? null,
            dataset: testcase.metadata.dataset ?? null,
            model: testcase.input.modelName as AvailableModel,
            harness: testcase.metadata.harness ?? options.harness,
            environment: testcase.metadata.environment ?? options.environment,
            useApi: testcase.metadata.api ?? options.useApi,
            provider: testcase.metadata.provider ?? null,
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
